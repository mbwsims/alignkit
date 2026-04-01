# alignkit

Instruction intelligence for coding agents.

You write a `CLAUDE.md` to shape how coding agents behave in your codebase. But you have no easy way to know whether those rules are well-structured, whether the agent actually follows them, or which rules are wasting tokens. alignkit gives you that visibility.

alignkit is currently in beta. It is optimized for Claude Code projects, with broader lint support for related instruction formats such as `AGENTS.md`, `.cursor/rules`, `.claude/agents`, and `.claude/skills`.

```bash
npx alignkit
```

## What it does

**`check`** reads Claude Code session history and estimates whether each rule was actually followed. It separates relevant sessions from resolved and inconclusive evidence, surfaces supporting evidence, and shows which rules were never exercised at all. With `--deep`, it uses an LLM to evaluate rules that pattern matching cannot judge reliably.

**`lint`** finds problems in your instruction files before the agent ever sees them — vague rules, contradictions, redundancies, stale version references, poor ordering, formatting rules that belong in a linter, critical rules that use weak language, and rules that belong in scoped files, skills, hooks, or subagents instead of global memory.

**`lint --deep`** uses an LLM to go further: predicts which rules the agent is likely to ignore, flags rules Claude already knows from reading code, identifies important behaviors your rules don't cover, and suggests how to consolidate related rules into fewer, stronger ones.

**`init`** generates a starter `CLAUDE.md` for your project if you do not have one yet. It detects your stack (framework, test runner, database, styling, package manager) and assembles rules from templates. With `--deep`, it uses an LLM for a more tailored result.

## Quick start

```bash
# Check which rules your agent actually follows
npx alignkit check

# Check with LLM evaluation for rules pattern matching can't cover
npx alignkit check --deep

# Analyze your instruction file (zero config, free)
npx alignkit

# LLM-powered deep analysis (~$0.05, requires ANTHROPIC_API_KEY)
npx alignkit lint --deep

# Generate a CLAUDE.md for your project
npx alignkit init
```

## Who it's for

alignkit is most useful if you:

- use Claude Code seriously enough that instruction quality affects real work
- want to know whether your rules are actually being followed, not just whether they sound good
- keep instruction logic in more than one place (`CLAUDE.md`, scoped rules, agents, skills, `AGENTS.md`, `.cursor/rules`)
- want local CLI/MCP tooling, machine-readable output, or CI checks instead of a purely in-Claude workflow

alignkit is probably overkill if you:

- only need a starter `CLAUDE.md` and nothing beyond that
- only need occasional in-Claude auditing and memory cleanup
- do not care about history-backed adherence or structured lint output

## Why use this if Claude already has `CLAUDE.md Management`?

Anthropic's official [`CLAUDE.md Management`](https://claude.com/plugins/claude-md-management) plugin is real and useful. It audits `CLAUDE.md` quality, captures learnings from a session, and proposes updates to memory files from inside Claude Code.

If that is all you need, it may already be enough.

alignkit is trying to add value at a different layer:

- **History-backed adherence:** `check` estimates whether Claude actually followed your rules across real sessions. The official plugin focuses on improving memory quality, not measuring instruction follow-through over time.
- **Broader instruction surface:** alignkit linting is not limited to a single `CLAUDE.md`. It can analyze scoped rules, project agents, project skills, `AGENTS.md`, and Cursor-style rule files too.
- **Local and automatable workflows:** alignkit works as a CLI and MCP server, supports JSON output, and can run in CI. That makes it easier to treat instruction quality like an engineering workflow rather than a one-off manual audit.
- **Placement and structure advice:** alignkit tries to answer where an instruction belongs: global memory, scoped rule, skill, subagent, hook, or real tool config.

What alignkit does **not** replace:

- the official plugin's in-Claude revise flow
- Claude-native memory editing workflows
- Anthropic's own guidance on how memory, skills, and subagents should be structured

The honest comparison is:

- use the official plugin if you want Claude to help keep `CLAUDE.md` fresh from inside normal sessions
- use alignkit if you want deeper static analysis, broader instruction-format coverage, or evidence about whether your instruction system is working in practice
- use both if that fits your workflow

## What the output looks like

### `alignkit init`

Detects your stack and generates a `CLAUDE.md`.

```
$ alignkit init
Generated CLAUDE.md
  Detected: pnpm, typescript, nextjs, vitest, prisma
  18 lines. Run alignkit lint to check it.
```

```markdown
## Code

- TypeScript strict mode. No `any`.
- Use server components by default. Client components only when needed.
- Use Next.js App Router conventions for routing and layouts.
- Use Prisma for all data access — no raw SQL.
- Use Tailwind utility classes for styling. Avoid custom CSS unless necessary.

## Process

- Run tests before committing.
- Never commit .env files or secrets.

## Commands

- `pnpm dev` — start dev server
- `pnpm build` — production build
- `pnpm test` — run tests with vitest
- `pnpm lint` — run linter
```

### `alignkit lint`

Finds structural issues. No API key needed, and it runs instantly.

```
CLAUDE.md — 34 rules, ~1,200 tokens (estimated)

  ⚠ VAGUE          "Be careful with state management"
     No verifiable behavior. Rewrite as: "Always/Never [action] when [condition]"

  ⚠ CONFLICT       "Always use named exports" contradicts
     "Use default exports for React components"

  ⚠ REDUNDANT      "Always show user feedback for errors" is similar to
     "Always have onError handler with user feedback"

  ⚠ LINTER_JOB     "Use 2 space indentation"
     This rule belongs in prettier/eslint, not CLAUDE.md.

  ⚠ WEAK_EMPHASIS  "You should use Prisma for data access"
     High-priority rule uses weak language. Use MUST, NEVER, ALWAYS.

  ⚠ ORDERING       5 high-priority rules appear after line 80.
     Agents attend more to early content.

HEALTH  34 rules, 22 auto-verifiable, 3 vague, 1 linter-job, 1 weak-emphasis
TOKENS  ~1,200 (~0.6% of context window). Recommended: under 2,000.

QUICK WINS
  → Merge 1 redundant rule pair → run alignkit optimize
  → Move 5 high-priority rules to top of file → run alignkit optimize
  → Move 1 formatting rule to linter/formatter config
  → Strengthen 1 critical rule with emphatic language (MUST, NEVER, ALWAYS)
```

### `alignkit lint --deep`

Everything above, plus LLM-powered analysis of your rules against your project structure. It flags rules Claude already knows from reading code, which waste instruction budget.

```
EFFECTIVENESS PREDICTIONS
  ⚠ LOW     "Prefer composition over inheritance"
           Too abstract — doesn't specify when/how to apply in this project.
           Rewrite: "Use hooks and composition for shared behavior between
           components. Avoid class-based inheritance for React components."

  ⚠ LOW     "Use meaningful variable names"
           Claude already knows this from reading the code.
           Rewrite: REMOVE

COVERAGE GAPS
  ✗ MISSING  Error handling
           No guidance for handling API errors or network failures, but
           project has 12 API routes and axios in dependencies.

  ✗ MISSING  Test organization
           No rules for test structure despite 40+ test files.

CONSOLIDATION
  ⚠ MERGE   3 error-handling rules could merge (saves ~45 tokens):
           "Always handle errors with user feedback: catch all errors, log
           appropriately, and show meaningful messages to users."
```

### `alignkit check --deep`

Measures per-rule adherence from your Claude Code session history. `--deep` uses an LLM to evaluate rules that pattern matching cannot cover.

```
CLAUDE.md last modified: 5 days ago
Found 14 sessions since then.

 Rule                                    Sessions  Resolved  Followed  Adherence  Confidence  Method
 ───────────────────────────────────────────────────────────────────────────────────────────────────────
 "Use pnpm, not npm"                     9/14      9/9       9/9       100% ✓     high        auto:bash-keyword
 "Run tests before committing"           12/14     12/12     10/12      83% ~     medium      auto:bash-sequence
 "TypeScript strict mode"                14/14     9/14      9/9       100% ✓     medium      llm-judge
 "Prisma for all data access"            11/14     7/11       5/7        71% ✗     low         llm-judge
 "Add JSDoc to public functions"          7/14      0/7       -          ?         low         llm-judge

 2 rules auto-evaluated · 3 rules LLM-evaluated · 1 inconclusive
```

Every row includes sample size, verification method, and a confidence estimate calibrated to evidence quality, consistency, and coverage.

## Additional commands

```bash
# Quick pulse check from history
alignkit status
# → CLAUDE.md  78% adherence across 14 sessions  ▁▃▅▇▇ trending up

# Trend analysis with recommendations
alignkit report --days 30

# Generate improved instruction file (never modifies original)
alignkit optimize

# Background daemon that builds history over time
alignkit watch
```

## MCP server

alignkit includes an MCP server for Claude Code integration. When used as an MCP tool, Claude analyzes your instruction files directly — no separate API key needed, no additional cost beyond your normal Claude Code usage.

```jsonc
// In your Claude Code MCP config:
{
  "mcpServers": {
    "alignkit": {
      "command": "npx",
      "args": ["-y", "-p", "alignkit", "alignkit-mcp"]
    }
  }
}
```

This gives Claude access to `alignkit_lint`, `alignkit_check`, and `alignkit_status` tools.

## CI integration

```bash
# Fail the build if any issues are found
npx alignkit lint --ci

# JSON output for programmatic consumption
npx alignkit lint --format json
npx alignkit check --format json
```

`--ci` returns exit code 1 when diagnostics are found. Without `--ci`, `lint` always exits 0.

## How it works

**Init** detects your project's stack (package manager, framework, language, test runner, database, styling, linter, monorepo) and assembles rules from templates. With `--deep`, it sends project metadata to the Anthropic API for a more tailored result.

**Lint** parses your instruction files into individual rules, classifies each by type (tool-constraint, code-structure, process-ordering, style-guidance, behavioral), and runs deterministic checks for vague language, near-duplicates, conflicts, version references, ordering, linter-job detection (rules that belong in eslint/prettier), weak emphasis, placement, and token/rule counting.

**Lint --deep** sends rule text and project metadata (directory names, dependency names — not source code) to the Anthropic API for effectiveness prediction (including flagging rules Claude already knows), coverage gap analysis, and consolidation suggestions.

**Check** reads Claude Code session logs from `~/.claude/projects/`, extracts tool-use actions (Bash commands, file writes, edits, reads), and verifies each rule using pattern-matching strategies:

| Strategy | What it checks | Confidence |
|---|---|---|
| `bash-keyword` | Tool/command usage in Bash actions | High |
| `bash-sequence` | Temporal ordering of commands | Medium |
| `file-pattern` | File paths in Write/Edit actions | High |
| `heuristic-structure` | Code patterns via regex | Medium |

`check` aggregates those observations into per-rule adherence, separating:
- relevant sessions
- resolved sessions with concrete pass/fail evidence
- inconclusive sessions where the rule mattered but evidence was insufficient
- out-of-scope sessions where the rule did not apply

**Check --deep** sends unresolved rules + session action summaries to the LLM for evaluation, covering rules that pattern matching cannot handle well on their own.

## Current strengths

- **`check` is the most differentiated part of the product.** It does more than lint rule text: it estimates whether Claude actually followed your instructions in real sessions.
- **`lint` covers a wider instruction surface than a single `CLAUDE.md`.** It now understands effective Claude memory, scoped rules, subagents, and project skills.
- **Placement advice reflects the modern Claude workflow model.** alignkit can flag when a rule belongs in scoped memory, a skill, a hook, a subagent, or actual tool config instead of global memory.
- **Adherence reporting is intentionally explicit.** Every rule shows sample size, method, and confidence, and unresolved or inconclusive rules are surfaced instead of being quietly treated as verified.

## Current limitations

- **`check` is still an evidence system, not an enforcement system.** It can tell you what likely happened in observed sessions, but it cannot prove compliance in the abstract.
- **The auto-classifier still puts many rules in a catch-all "behavioral" bucket.** Rules with unusual phrasing or domain-specific language may not be classified correctly. This affects which verification strategy is used. `--deep` compensates for part of this.
- **The parser is intentionally conservative.** It is much better with mixed instruction files than before, but prose-heavy workflow guidance can still be missed if it does not read clearly like an instruction.
- **Token counting is approximate.** We use the GPT-4 tokenizer (`cl100k_base`), not Claude's. Counts may differ by up to ~20%.
- **watch, report, and status need accumulated data to be useful.** They work correctly but produce thin output until you have multiple sessions. These features mature over time.
- **Session-based features only work with Claude Code.** Cursor, Windsurf, and other agent session formats are not supported for check/watch/report/optimize. Lint works on all instruction file formats.

## Format support

| Format | init | lint | check |
|---|---|---|---|
| CLAUDE.md | Yes | Yes | Yes (Claude Code sessions) |
| .claude/rules | — | Yes | Yes (Claude Code sessions) |
| .claude/agents/*.md | — | Yes | Yes (explicit file, Claude Code sessions) |
| .claude/skills/*/SKILL.md | — | Yes | — |
| AGENTS.md | — | Yes | Yes (Claude Code sessions) |
| .cursorrules | — | Yes | Not yet |
| .cursor/rules | — | Yes | Not yet |

## Privacy

**By default, alignkit is fully local.** `init`, `lint`, `check`, `watch`, `status`, `report`, and `optimize` never make network requests. Your instruction files, session logs, and source code stay on your machine.

**Opt-in features that make API calls:**

| Feature | What's sent to the Anthropic API |
|---|---|
| `init --deep` | Project metadata (directory names, dependency names, scripts). **Not** source code. |
| `lint --deep` | Rule text + project metadata (directory names, dependency names). **Not** source code. |
| `check --deep` | Rule text + session action summaries (commands run, files written). |

All require `ANTHROPIC_API_KEY`. If you never set it, nothing ever leaves your machine.

No telemetry. No analytics. No phone-home.

## Configuration

Optional. Everything works with zero configuration.

```jsonc
// .alignkit.config.jsonc
{
  "instructionFile": "./CLAUDE.md",
  "thresholds": { "tokenBudget": 2000, "flagBelow": 20 },
  "contextWindow": 200000
}
```

## Requirements

- Node.js 18+
- Claude Code session history (for check/watch/report/optimize)
- `ANTHROPIC_API_KEY` (only for `--deep`)

## License

MIT
