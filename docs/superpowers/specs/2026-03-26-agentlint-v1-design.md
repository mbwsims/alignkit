# agentlint v1 — Technical Specification

A TypeScript CLI that measures, debugs, and optimizes AI coding agent instruction files. v1 is Claude Code focused.

---

## Scope

**In v1:**
- `agentlint lint` — static analysis of instruction files, zero cost
- `agentlint lint --deep` — LLM-powered analysis (effectiveness prediction, coverage gaps, consolidation, rewrites), requires API key
- `agentlint check` — per-rule adherence from Claude Code session history, zero cost
- `agentlint watch` — background daemon that monitors sessions and populates history
- `agentlint status` — quick adherence pulse check from history
- `agentlint report` — trend analysis with recommendations from history
- `agentlint optimize` — generate improved instruction file from adherence data

**Out of v1:**
- Task-based mode (running agents on synthetic tasks)
- Cursor session reader (lint-only for .cursorrules, no session analysis)
- Git-based fallback inference
- Multi-model comparison
- Narrative/character testing
- Plugin system for custom parsers or verifiers

**Distribution:** npm package. `npx agentlint lint` works with zero install.

**Language:** TypeScript, targeting Node 18+.

---

## Data Model

### Rule

Normalized representation of a single instruction/directive, regardless of source format.

```typescript
interface Rule {
  // Stable hash of normalized rule text. Used as primary key in history.
  // Hashing normalized text (lowercased, whitespace-collapsed) means minor
  // edits like fixing a typo don't reset the rule's tracking history.
  id: string;

  // Raw text as it appears in the instruction file.
  text: string;

  // Source location for error reporting.
  source: {
    file: string;
    lineStart: number;
    lineEnd: number;
  };

  // Classification. Determined by keyword analysis during parsing.
  //
  // tool-constraint:   references a specific tool or command (pnpm, git, docker)
  // code-structure:    references code patterns (exports, imports, types, naming)
  // process-ordering:  specifies sequencing (run X before Y)
  // style-guidance:    subjective quality (clean code, meaningful names)
  // behavioral:        agent meta-behavior (ask questions, think step by step)
  // meta:              about the instruction file itself or project setup
  category: 'tool-constraint' | 'code-structure' | 'process-ordering'
           | 'style-guidance' | 'behavioral' | 'meta';

  // Whether the rule can be verified automatically, needs user config, or
  // cannot be verified at all. Drives what appears in check output.
  verifiability: 'auto' | 'user-config' | 'unverifiable';

  // Structural issues found during lint. Each diagnostic has a severity
  // and a human-readable message explaining the problem and how to fix it.
  diagnostics: Diagnostic[];
}

interface Diagnostic {
  severity: 'error' | 'warning';
  code: 'VAGUE' | 'CONFLICT' | 'REDUNDANT' | 'STALE' | 'ORDERING';
  message: string;
  // For CONFLICT and REDUNDANT: the other rule involved.
  relatedRuleId?: string;
}
```

### AgentAction

Normalized representation of a single action taken by the agent during a session. Extracted from Claude Code tool_use blocks.

```typescript
type AgentAction =
  | { type: 'bash'; command: string; exitCode?: number; timestamp: string }
  | { type: 'write'; filePath: string; content: string; timestamp: string }
  | { type: 'edit'; filePath: string; oldContent: string; newContent: string; timestamp: string }
  | { type: 'read'; filePath: string; timestamp: string };
```

### Observation

Result of verifying one rule against one session.

```typescript
interface Observation {
  ruleId: string;
  sessionId: string;
  // false = rule didn't apply in this session (e.g., "use pnpm" but no
  // package manager was invoked). Not counted in adherence calculations.
  relevant: boolean;
  // null = relevant but couldn't determine (unmapped rule).
  // Only non-null when relevant is true.
  followed: boolean | null;
  // How the verdict was produced. Always shown in output so users know
  // what's behind every number.
  method: 'auto:bash-keyword' | 'auto:bash-sequence' | 'auto:file-pattern'
        | 'auto:ast-check' | 'user:custom' | 'llm-judge' | 'unmapped';
}
```

### Session Result (history storage)

One line in `.agentlint/history.jsonl`:

```typescript
interface SessionResult {
  sessionId: string;
  timestamp: string; // ISO 8601
  // Hash of the instruction file at time of analysis. Used to segment
  // history into epochs when the file changes.
  rulesVersion: string;
  observations: Observation[];
}
```

---

## Components

### 1. Instruction File Parsers

**Input:** file path (or auto-discovered)
**Output:** `Rule[]`

Auto-discovery order: `CLAUDE.md` > `.cursorrules` > `AGENTS.md` > `.cursor/rules`

Each parser splits the instruction file into individual rules and classifies them. The parsers normalize to the same `Rule[]` interface so the rest of the system is format-agnostic.

**Parsing strategy:**

CLAUDE.md and AGENTS.md are markdown. Rules are extracted by:
1. Split on headings (##, ###) to get sections
2. Within sections, split on list items (-, *, numbered) and standalone sentences/paragraphs
3. Each extracted chunk is one Rule
4. Headings provide context (a rule under "## Testing" gets different classification weight than one under "## Style")

.cursorrules is typically plain text or markdown-like. Same strategy with looser heading detection.

**Classification heuristics (no LLM):**

| Keywords/patterns | Category |
|---|---|
| Tool names: `pnpm`, `npm`, `yarn`, `git`, `docker`, `pytest`, `jest`, `eslint` | `tool-constraint` |
| Code patterns: `export`, `import`, `type`, `interface`, `class`, `async`, `strict` | `code-structure` |
| Sequencing: `before`, `after`, `first`, `then`, `prior to` + action verbs | `process-ordering` |
| Subjective: `clean`, `readable`, `meaningful`, `good`, `proper`, `careful` | `style-guidance` |
| Meta-behavior: `think`, `consider`, `ask`, `explain`, `step by step` | `behavioral` |

A rule can match multiple categories. Priority order determines the final classification (tool-constraint wins over style-guidance if both match).

**Verifiability mapping:**

| Category | Default verifiability |
|---|---|
| `tool-constraint` | `auto` |
| `code-structure` | `auto` |
| `process-ordering` | `auto` |
| `style-guidance` | `unverifiable` |
| `behavioral` | `unverifiable` |
| `meta` | `user-config` |

### 2. Static Analyzer (lint)

**Input:** `Rule[]`
**Output:** `Rule[]` with `diagnostics` populated

Runs these checks (all deterministic, no LLM):

**Token analysis:**
- Count tokens using `js-tiktoken` with `cl100k_base` encoding
- Calculate context window percentage (against 200k default, configurable)
- Flag if over configurable threshold (default: 2,000 tokens)

**Vague language detection:**
- Regex patterns for hedging language: `be careful`, `try to`, `consider`, `when appropriate`, `as needed`, `if possible`, `think about`
- Diagnostic includes template guidance: "Rewrite as a concrete constraint: 'Always/Never [action] when [condition]'"

**Near-duplicate detection:**
- Tokenize each rule into word sets (lowercased, stop words removed)
- Jaccard similarity between all rule pairs
- Flag pairs above 0.6 similarity as REDUNDANT
- O(n^2) but n is small (typically <100 rules)

**Version reference flagging:**
- Regex for version patterns: `v\d`, `\d+\.\d+`, `\d+\.x`, semver patterns
- Flag as STALE with message: "References a specific version. Verify this is current."

**Ordering analysis:**
- Rules classified as `tool-constraint` or `process-ordering` (high-signal categories) appearing in the bottom half of the file get an ORDERING warning
- Message: "High-priority rules appear late in the file. Agents attend more to early content."

**Conflict detection (lexical only — semantic conflicts require --deep):**
- Detect negation pairs: "always use X" vs "never use X", "use X" vs "don't use X"
- Detect tool conflicts: "use pnpm" vs "use npm" (same tool category, different tools)
- String matching only. Will miss semantic conflicts like "use default exports" vs "use named exports" — that's what `--deep` is for.

### 3. Deep Analyzer (lint --deep)

**Input:** `Rule[]`, project context (package.json, tsconfig.json, directory tree)
**Output:** enriched `Rule[]` with LLM-generated diagnostics and suggestions

Single LLM call (or batched into 2-3 if the rule set is large). Sends:
- All rules
- Project metadata: package.json dependencies, tsconfig compiler options, top-level directory listing
- Structured prompt asking for four analyses

**Rule effectiveness prediction:**
For each rule, the LLM assesses whether it's likely to be followed based on:
- Specificity (concrete vs abstract)
- Position in file
- Whether it conflicts with common model behaviors
- Whether it's reinforced by other rules
Returns a predicted effectiveness score and suggested rewrite if score is low.

**Coverage gap analysis:**
Given the project structure, identify important behaviors the instruction file doesn't cover. E.g., "Your project uses React Query but no rules mention data fetching patterns" or "You have 40 API routes but no error handling guidelines."

**Smart consolidation:**
Identify groups of related rules that could be merged into fewer, stronger rules. Return the merged versions with token savings.

**Concrete rewrites:**
For rules flagged as vague by the static analyzer, generate specific rewrites informed by the project context.

**Cost:** One Anthropic API call. Typically <$0.10 depending on rule count and project size. Requires `ANTHROPIC_API_KEY` env var or config.

### 4. Session Reader

**Input:** project directory path
**Output:** `Map<sessionId, AgentAction[]>`

Reads Claude Code session logs from `~/.claude/projects/`.

**Project resolution:**
Claude Code stores sessions under `~/.claude/projects/<hash>/`. The session reader:
1. Reads `sessions-index.json` files across project directories
2. Matches the current working directory to the correct project hash by comparing stored project paths
3. Fails clearly if no match: "No Claude Code sessions found for this project directory."

**Session discovery:**
From the matched project directory, read `sessions-index.json` for session metadata (timestamps, session IDs). Filter to sessions after the instruction file's last git-modified date (determined by `git log -1 --format=%cI -- <instruction-file>`).

**JSONL parsing:**
For each relevant session, parse the JSONL file(s):
1. Each line is a JSON object with `type` and `message` fields
2. Skip lines where `isCompactSummary: true` (compacted earlier context)
3. From assistant messages, extract `tool_use` content blocks
4. Map tool_use blocks to `AgentAction` objects based on the `name` field:
   - `name: "Bash"` → `BashAction` with `input.command`
   - `name: "Write"` → `WriteAction` with `input.file_path` and `input.content`
   - `name: "Edit"` → `EditAction` with `input.file_path`, `input.old_string`, `input.new_string`
   - `name: "Read"` → `ReadAction` with `input.file_path`
5. Extract timestamps from message metadata for ordering analysis

**Cross-file continuation:**
A single logical session can span multiple JSONL files. Reconstruct by grouping on `sessionId` across files in the project directory.

**Active session handling:**
Skip JSONL files whose filesystem modified time is less than 2 minutes ago. This avoids parsing sessions still in progress, which could have partially-written JSON lines.

**Error handling:**
- Malformed JSON lines: skip and continue (log a warning)
- Missing fields in tool_use blocks: skip that action (don't crash)
- Unknown tool names: ignore (we only care about Bash, Write, Edit, Read)
- No sessions found after filter date: report clearly with session count before filter date so user knows data exists but predates current rules

**Implementation note:** We implement our own parser scoped to tool_use extraction. Existing open-source parsers (claude-code-log, clog) are used as references for edge case discovery, not as dependencies. Our parser is intentionally minimal — it extracts actions, not conversation content.

### 5. Verifier Engine

**Input:** `Rule`, `AgentAction[]` (from one session)
**Output:** `Observation`

The verifier engine determines whether a rule was relevant to a session and whether it was followed.

**Auto-mapper:**
Maps each rule to a verification strategy based on its category and keywords.

| Rule pattern | Verification strategy | Example |
|---|---|---|
| References specific CLI tool | Scan Bash actions for tool name. Check correct tool was used, alternative was not. | "use pnpm not npm" → check Bash commands contain `pnpm`, not `npm` |
| References file extension or directory | Scan Write/Edit file paths with glob matching. | "tests in `__tests__/`" → check test file Write paths match `**/__tests__/**` |
| Specifies ordering of actions | Check temporal ordering of matching Bash actions within the session. | "run tests before committing" → find test command timestamp < git commit timestamp |
| References code structure keywords | Parse Write/Edit content as AST (TypeScript/JavaScript via tree-sitter or ts-morph). Check structural properties. | "use named exports" → parse written files, check for named vs default exports |
| No actionable keywords | Return `{ relevant: true, followed: null, method: 'unmapped' }` | "be consistent" |

**Relevance determination:**
A rule is relevant to a session only if the session contains actions where the rule could apply:
- Tool rules: at least one Bash action invoked a related tool category
- File pattern rules: at least one Write/Edit action touched a matching path
- Process ordering rules: at least one action from each part of the sequence exists
- Code structure rules: at least one Write/Edit action created/modified code files

If no matching actions exist, the rule is `{ relevant: false }` for that session.

**User-configured verifiers:**
Users can override auto-mapping in `.agentlint.config.json`:
```json
{
  "rules": {
    "always-add-error-handling": {
      "verifier": "custom",
      "check": "grep:catch|try|\\.catch in write:src/routes/**"
    }
  }
}
```

Custom check DSL: `grep:<pattern> in <action-type>:<file-glob>`
- `<pattern>`: regex matched against action content
- `<action-type>`: `bash`, `write`, `edit`
- `<file-glob>`: glob matched against file paths (for write/edit) or command strings (for bash)

**LLM-as-judge (opt-in per rule):**
```json
{
  "rules": {
    "use-meaningful-variable-names": {
      "verifier": "llm-judge"
    }
  }
}
```
Sends the rule text plus relevant Write/Edit content to the LLM. Returns followed: true/false. Costs per invocation. Not recommended for high-volume use with `watch`.

### 6. History Store

**Storage:** `.agentlint/history.jsonl` — append-only file.

Each line is a JSON object conforming to `SessionResult`:
```jsonl
{"sessionId":"abc123","timestamp":"2026-03-25T15:14:00Z","rulesVersion":"a1b2c3","observations":[{"ruleId":"r1","relevant":true,"followed":true,"method":"auto:bash-keyword"},{"ruleId":"r2","relevant":false,"followed":null,"method":"auto:bash-keyword"}]}
```

**Rules version tracking:**
The `rulesVersion` field is a hash of the instruction file content at the time of analysis. When `watch` or `check` detects that the instruction file has changed (by comparing the current hash to the last recorded one), it starts a new epoch. Queries that compute trends (report, status) segment by epoch so that adherence changes after a rule edit are visible.

**Querying:**
Load the full file into memory, parse each line, filter/aggregate in code. At expected data volumes (hundreds of lines over months), this is <1ms. No indexing needed.

**Concurrency:**
The `watch` daemon appends to this file. `check` may also append. Append operations to a file are atomic on macOS/Linux for lines under ~4KB (well within our line sizes). No locking needed.

**Garbage collection:**
None in v1. The file grows indefinitely but slowly. A session with 50 rules produces ~2KB of JSONL. A year of daily use at 5 sessions/day = ~3.5MB. Not a concern.

---

## CLI Commands

All commands auto-discover the instruction file if not specified. Discovery order: `CLAUDE.md` > `.cursorrules` > `AGENTS.md` > `.cursor/rules`.

### `agentlint lint [file]`

Static analysis. No session data, no API keys, no cost.

```
$ agentlint lint

Auto-detected: ./CLAUDE.md

CLAUDE.md — 47 rules, ~3,200 tokens

 ISSUES:

 ✗  VAGUE       Rule 8 ("Be careful with state management")
                 No verifiable behavior. Rewrite as a concrete constraint:
                 "Always/Never [action] when [condition]"

 ✗  CONFLICT    Rule 12 ("Always use named exports") contradicts
                 Rule 34 ("Use default exports for React components")

 ✗  REDUNDANT   Rules 15 and 29 express the same constraint differently

 ⚠  STALE       Rule 22 references "Tailwind v3" — verify current

 ⚠  ORDERING    15 high-priority rules appear after line 100.
                 Agents attend more to early content.

 HEALTH: 47 rules — 31 auto-verifiable, 7 vague, 4 conflicting, 3 redundant, 2 stale
 TOKENS: ~3,200 (~18% of effective context window). Recommended: under 2,000.
```

**`--deep` adds LLM analysis (requires ANTHROPIC_API_KEY):**

```
$ agentlint lint --deep

 ... (all static diagnostics above, plus:)

 EFFECTIVENESS PREDICTIONS:

 ⚠  LOW         Rule 23 ("Always create a feature branch before changes")
                 Process-ordering rules without explicit tool names have ~30%
                 adherence. Rewrite: "Run 'git checkout -b feature/<name>'
                 before making any file changes."

 COVERAGE GAPS:

 ✗  MISSING     Your project uses React Query (found in package.json) but no
                 rules mention data fetching patterns or cache invalidation.

 ✗  MISSING     14 API routes in src/routes/ but no error handling guidelines.

 CONSOLIDATION:

 ⚠  MERGE       Rules 3, 7, 14, 22 all relate to TypeScript strictness.
                 Suggested merge (saves ~120 tokens):
                 "Use TypeScript strict mode. All functions must have explicit
                  return types. Never use 'any' — use 'unknown' for truly
                  dynamic types. Prefer interfaces over type aliases for
                  object shapes."
```

**Flags:**
- `--deep` — enable LLM analysis (requires API key)
- `--json` — machine-readable JSON output
- `--format <format>` — output format: `terminal` (default), `json`, `markdown`

### `agentlint check [file]`

Per-rule adherence from Claude Code session history.

```
$ agentlint check

Auto-detected: ./CLAUDE.md
CLAUDE.md last modified: 5 days ago (commit a1b2c3d)
Found 14 sessions since then.

RULE ADHERENCE:

 Rule                                    Sessions  Followed  Adherence  Method
 ───────────────────────────────────────────────────────────────────────────────
 "Use pnpm, not npm"                     9/14      9/9       100% ✓     auto:bash-keyword
 "Always run tests before committing"    14/14     12/14      86% ✓     auto:bash-sequence
 "Use named exports"                     11/14      8/11      73% ~     auto:ast-check
 "Add JSDoc to public functions"          7/14      2/7       29% ✗     auto:ast-check
 "Create a branch before changes"        14/14      2/14      14% ✗     auto:bash-sequence
 "Think step by step"                     —          —        n/a       unmapped:unverifiable
 "Use meaningful variable names"          —          —        n/a       unmapped:complex

 14 rules auto-verified · 2 unverifiable · 1 needs custom check

 TOKEN BUDGET:
 Removing 3 low-adherence rules saves ~400 tokens with minimal behavior change.
```

**Partial data (1-2 sessions):**
```
$ agentlint check

Found 2 sessions since last CLAUDE.md change.
⚠ Limited data — treat as directional, not definitive.

 "Use pnpm, not npm"                     2/2       2/2       100% ✓
 "Run tests before committing"           2/2       1/2        50% ~
 "Create a branch before changes"        2/2       0/2         0% ✗
```

**When DB exists:** reads from `.agentlint/history.jsonl` instead of re-parsing sessions. Falls back to fresh parse if DB is stale or missing.

**Flags:**
- `--json` — machine-readable output
- `--format <format>` — terminal, json, markdown

### `agentlint watch`

Background daemon. Polls for new sessions, analyzes them, appends to history.

```
$ agentlint watch

Watching: ~/.claude/projects/<hash>/
Tracking: ./CLAUDE.md (47 rules, last modified 5 days ago)
History: .agentlint/history.jsonl

[03:14 PM] Session abc123 — 31 rules checked, 26 followed (84%)
[03:47 PM] Session def456 — 28 rules checked, 22 followed (79%)
[04:02 PM] CLAUDE.md changed (commit b2c3d4e) — new tracking epoch
[04:15 PM] Session ghi789 — 29 rules checked, 25 followed (86%)
```

**Implementation:**
- Poll `sessions-index.json` every 30 seconds for new session entries
- On new session: wait for completion (modified time >2 min ago), parse, verify, append to history
- On instruction file change (detected via git or file hash): log new epoch, update active rule set
- Designed to run in a terminal tab or as a system service

**Flags:**
- `--interval <seconds>` — polling interval (default: 30)
- `--quiet` — suppress per-session output, only log errors and epoch changes

### `agentlint status`

Quick pulse check. Reads from history file only.

```
$ agentlint status

CLAUDE.md  78% adherence across 14 sessions (last 5 days)  ▁▃▅▇▇ trending up
  31 rules tracked · 24 auto-verified · 2 consistently ignored · 3 new
```

Single line designed to be embeddable in shell prompts or aliases.

**If no history exists:**
```
$ agentlint status

No history found. Run `agentlint watch` to start collecting data,
or `agentlint check` for a one-time analysis.
```

### `agentlint report`

Trend analysis with recommendations. Reads from history file.

```
$ agentlint report

ADHERENCE REPORT — last 7 days (14 sessions)

Overall: 71% → 78% (+7%)

IMPROVED:
  ✓ "Run tests before committing"         60% → 86%  (reworded on Tue)
  ✓ "Use TypeScript strict mode"           80% → 93%

DEGRADED:
  ✗ "Add JSDoc to public functions"        18% → 12%  (consistently ignored)

STABLE:
  ~ "Use pnpm, not npm"                   100% → 100%
  ~ "Use named exports"                    73% → 71%

NEW RULES (added this week):
  ★ "Always create a feature branch"       3 sessions, 100% adherence so far

RECOMMENDATIONS:
  • "Add JSDoc to public functions" has been below 20% for 2 weeks.
    Consider removing it (saves ~40 tokens) or rephrasing.
  • 3 rules have never been relevant in any session.
    They may be too specific to trigger, or irrelevant to your current work.
```

**Flags:**
- `--days <n>` — reporting window (default: 7)
- `--html` — generate `.agentlint/report.html` with charts and per-rule sparklines
- `--json` — machine-readable output
- `--format <format>` — terminal, json, markdown, html

### `agentlint optimize [file]`

Generate an improved instruction file from adherence data.

```
$ agentlint optimize

Auto-detected: ./CLAUDE.md
Using adherence data from 14 sessions...

Step 1 — Prune:       Removed 5 rules with <20% adherence (saves 380 tokens)
Step 2 — Deduplicate: Merged 3 near-duplicate rule pairs (saves 180 tokens)
Step 3 — Reorder:     Moved top-performing rules to first 500 tokens
Step 4 — Drop:        Removed 2 rules never observed in any session

RESULT:
  Before: 47 rules, 3,200 tokens, 67% avg adherence
  After:  28 rules, 1,800 tokens, est. 81% adherence

  Output: CLAUDE.optimized.md
  Diff:   agentlint-diff.md (shows every change with reasoning)
```

**Steps:**
1. **Prune:** Remove rules with adherence below threshold (default: 20%). These consume tokens but don't influence behavior.
2. **Deduplicate:** Merge near-duplicate rules (Jaccard similarity >0.6) — keep the one with higher adherence.
3. **Reorder:** Move highest-adherence rules to the top of the file.
4. **Drop unobserved:** Remove rules that were never relevant in any analyzed session.

All steps are deterministic and free. No LLM calls.

**With `--deep` (LLM consolidation):**
Adds a step between Deduplicate and Reorder: send related rule groups to the LLM for intelligent merging into fewer, stronger rules. Same API call pattern as `lint --deep`.

**Output:** Always writes a new file (`CLAUDE.optimized.md`), never modifies the original. Also writes a diff file explaining each change.

---

## Configuration

### `.agentlint.config.json`

Optional. Everything works with zero configuration.

```json
{
  // Path to instruction file. Overrides auto-discovery.
  "instructionFile": "./CLAUDE.md",

  // Per-rule verifier overrides.
  "rules": {
    "always-add-error-handling": {
      "verifier": "custom",
      "check": "grep:catch|try|\\.catch in write:src/routes/**"
    },
    "use-meaningful-variable-names": {
      "verifier": "llm-judge"
    }
  },

  // Thresholds for lint warnings and optimize pruning.
  "thresholds": {
    "tokenBudget": 2000,
    "pruneBelow": 20,
    "warnBelow": 50
  },

  // Context window size for percentage calculations.
  "contextWindow": 200000
}
```

**Custom check DSL:**

Format: `grep:<regex-pattern> in <action-type>:<file-glob>`

- `action-type`: `bash`, `write`, `edit`
- `file-glob`: matched against file paths (write/edit) or command strings (bash)
- `regex-pattern`: matched against action content

Examples:
- `grep:catch|try in write:src/**/*.ts` — check that written TS files contain error handling
- `grep:pnpm in bash:*` — check that bash commands use pnpm
- `grep:describe\\(|it\\( in write:**/*.test.*` — check that test files use describe/it blocks

**API key:** Read from `ANTHROPIC_API_KEY` environment variable. Not stored in config (to avoid accidental commits).

**Config resolution:** Check `.agentlint.config.json` in current directory, then `agentlint` key in `package.json`. No global config in v1.

---

## Privacy

agentlint reads Claude Code session logs, which contain full conversation history including source code, commands, and file contents. The privacy model:

**What we read:**
- `sessions-index.json` for session discovery (timestamps, project paths)
- JSONL session files — specifically `tool_use` blocks for tool name, command strings, file paths, and written content
- We parse conversation content only to extract structured `AgentAction` objects

**What we store:**
- `.agentlint/history.jsonl` contains only: rule IDs, session IDs, boolean verdicts (relevant/followed), verification method strings
- No source code, no commands, no file contents, no conversation text
- The history file contains no sensitive data

**What leaves the machine:**
- Nothing, unless the user explicitly opts into `--deep` or `llm-judge`, which sends rule text and project metadata (not source code, not session logs) to the Anthropic API
- No telemetry, no analytics, no phone-home in v1
- Future: opt-in anonymized community data sharing (rule categories + adherence rates, no rule text or project details)

**Recommendation:** Add `.agentlint/` to `.gitignore` by default. `agentlint init` (if we add it) should do this automatically.

---

## Project Structure

```
agentlint/
├── src/
│   ├── cli/                      # CLI entry points (one file per command)
│   │   ├── index.ts              # Main entry, command routing
│   │   ├── lint.ts
│   │   ├── check.ts
│   │   ├── optimize.ts
│   │   ├── watch.ts
│   │   ├── status.ts
│   │   └── report.ts
│   │
│   ├── parsers/                  # Instruction file → Rule[]
│   │   ├── types.ts              # Rule, Diagnostic interfaces
│   │   ├── claude-md.ts
│   │   ├── cursorrules.ts
│   │   ├── agents-md.ts
│   │   └── auto-detect.ts        # File discovery logic
│   │
│   ├── analyzers/                # Static analysis (lint)
│   │   ├── token-counter.ts      # js-tiktoken wrapper
│   │   ├── vague-detector.ts     # Hedging language patterns
│   │   ├── duplicate-detector.ts # Jaccard similarity
│   │   ├── conflict-detector.ts  # Negation patterns, tool conflicts
│   │   ├── version-flagger.ts    # Version reference regex
│   │   ├── ordering-analyzer.ts  # Priority rule positioning
│   │   └── deep-analyzer.ts      # LLM-powered analysis (--deep)
│   │
│   ├── sessions/                 # Claude Code session reading
│   │   ├── types.ts              # AgentAction types
│   │   ├── project-resolver.ts   # CWD → ~/.claude/projects/<hash>/
│   │   ├── session-discovery.ts  # sessions-index.json reader
│   │   ├── jsonl-parser.ts       # JSONL → AgentAction[] extraction
│   │   └── session-reader.ts     # Orchestrates resolution + discovery + parsing
│   │
│   ├── verifiers/                # Rule adherence verification
│   │   ├── types.ts              # Observation interface
│   │   ├── auto-mapper.ts        # Rule → verification strategy
│   │   ├── bash-keyword.ts       # Tool/command keyword matching
│   │   ├── bash-sequence.ts      # Temporal ordering of commands
│   │   ├── file-pattern.ts       # File path glob matching
│   │   ├── ast-check.ts          # Code structure verification
│   │   ├── custom-check.ts       # User-defined check DSL executor
│   │   ├── llm-judge.ts          # LLM-as-judge (opt-in)
│   │   └── verifier-engine.ts    # Orchestrates mapping + execution
│   │
│   ├── history/                  # JSONL history store
│   │   ├── types.ts              # SessionResult interface
│   │   ├── store.ts              # Read/append/query operations
│   │   └── epochs.ts             # Rules version tracking
│   │
│   ├── optimizer/                # Instruction file optimization
│   │   ├── pruner.ts             # Remove low-adherence rules
│   │   ├── deduplicator.ts       # Merge near-duplicates
│   │   ├── reorderer.ts          # Reorder by adherence
│   │   ├── dropper.ts            # Remove unobserved rules
│   │   ├── consolidator.ts       # LLM-powered merging (--deep)
│   │   └── diff-writer.ts        # Generate change explanations
│   │
│   └── reporters/                # Output formatting
│       ├── terminal.ts           # Rich terminal output (chalk/picocolors)
│       ├── json.ts               # Machine-readable JSON
│       ├── markdown.ts           # Markdown (for PRs, docs)
│       └── html.ts               # Interactive HTML report
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## Key Dependencies

| Package | Purpose | Why this one |
|---|---|---|
| `commander` or `citty` | CLI framework | Mature, well-typed, minimal |
| `js-tiktoken` | Token counting | Pure JS port of tiktoken, no native deps |
| `picocolors` | Terminal colors | Tiny, fast, no dependencies |
| `globby` | Glob matching | Standard, well-maintained |
| `chokidar` or polling | File watching (for `watch`) | Evaluate: polling `sessions-index.json` may be simpler than filesystem events |
| `@anthropic-ai/sdk` | LLM calls (--deep, llm-judge) | Official SDK, only loaded when needed |

**Explicit non-dependencies:**
- No `better-sqlite3` (native addon, install friction)
- No heavy AST parsers at initial launch — start with regex/string analysis for code structure checks, add tree-sitter WASM if accuracy demands it
- No bundler for the CLI — ship TypeScript compiled to ESM

---

## Technical Risks

**Session log format changes.**
Claude Code's JSONL format is undocumented and could change. Mitigation: defensive parsing (skip unknown fields, don't crash on missing data), integration tests against captured session samples, clear error messages when format is unrecognized. The format has been stable for months and multiple third-party tools depend on it, making silent breaking changes unlikely.

**Auto-mapper accuracy.**
Conservative mapping means some rules won't be auto-verified. Users may perceive this as the tool being limited. Mitigation: clear categorization of why rules are unmapped (unverifiable vs needs-config), easy path to user-configured checks, and honest messaging ("14 rules auto-verified, 2 unverifiable, 1 needs custom check").

**Stochastic agent behavior.**
The same rule might be followed in one session and ignored in the next. Mitigation: report adherence as rates, not booleans. Flag inconsistent rules explicitly. Partial data gets honest confidence warnings. Over time, watch accumulates enough data for stable rates.

**Large session files.**
Long Claude Code sessions produce large JSONL files (potentially 10MB+). Mitigation: stream-parse line by line, don't load entire files into memory. Extract only tool_use blocks, skip everything else.

**Anthropic ships this natively.**
If Claude Code adds built-in rule analysis, our core value prop shrinks. Mitigation: cross-format support (CLAUDE.md + .cursorrules + AGENTS.md), the community data play (aggregate insights across users), and the optimization loop (lint → check → optimize) which is more than any vendor will build for their own agent.

---

## Success Metrics

### Phase 1 — Breadth (Month 1)
Lint drives initial adoption.
- Installs (npm download count)
- "Ran lint at least once" (inferred from GitHub issues, tweets, blog mentions)
- Quality of output: do developers screenshot and share results?

### Phase 2 — Depth (Month 2-3)
Check and watch create retention.
- % of lint users who run `check` within 7 days
- % who configure `watch` within 30 days
- Repeat usage: how often do returning users run `check` or `status`?

### Phase 3 — Data moat (Month 3+)
Community insights become the differentiator.
- Opt-in rate for anonymized data sharing (when implemented)
- Dataset size and diversity
- Research outputs: blog posts, aggregate findings

**Instrumentation:** Build opt-in, anonymous usage tracking hooks from day one (command invoked, rule count, not rule content). Don't enable by default. Have the infrastructure ready so we're collecting data when we flip the switch.
