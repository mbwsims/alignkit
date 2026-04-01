# alignkit

Instruction intelligence for coding agents.

You write a `CLAUDE.md` to shape how coding agents behave in your codebase. But you have no easy way to know whether those rules are well-structured, whether the agent actually follows them, or which rules are wasting tokens. alignkit gives you that visibility.

alignkit is currently in beta. It is optimized for Claude Code projects, with broader lint support for related instruction formats such as `AGENTS.md`, `.cursor/rules`, `.claude/agents`, and `.claude/skills`.

```bash
npx alignkit
```

## Commands

**`alignkit check`** — reads Claude Code session history and estimates whether each rule was actually followed. Separates relevant sessions from resolved and inconclusive evidence, and shows which rules were never exercised. With `--deep`, uses an LLM to evaluate rules that pattern matching cannot judge.

**`alignkit lint`** — finds structural problems in your instruction files — vague rules, contradictions, redundancies, poor ordering, misplaced rules, and rules that belong in a linter instead of memory. With `--deep`, predicts which rules the agent will ignore, flags rules Claude already knows, identifies coverage gaps, and suggests consolidation.

**`alignkit init`** — generates a starter `CLAUDE.md` if you don't have one yet. Detects your stack (framework, test runner, database, styling, package manager) and assembles rules from templates. With `--deep`, uses an LLM for a more tailored result.

**`alignkit optimize`** — generates an improved instruction file based on lint diagnostics and adherence data. Never modifies the original. With `--deep`, adds LLM-powered consolidation.

`check`, `lint`, `init`, and `optimize` all support `--deep` for LLM-powered analysis. Requires `ANTHROPIC_API_KEY`.

### History-based commands

`check` writes results to `.alignkit/history.jsonl` each time you run it. The commands below read from that history — the more sessions `check` analyzes, the more useful they become.

**`alignkit status`** — quick pulse check. Shows overall adherence percentage, session count, and trend.

**`alignkit report`** — trend analysis with recommendations.

**`alignkit watch`** — runs `check` in the background on an interval, building history automatically.

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

Anthropic's official [`CLAUDE.md Management`](https://claude.com/plugins/claude-md-management) plugin audits quality, captures learnings, and proposes updates from inside Claude Code. If that's all you need, it may be enough.

alignkit adds a different layer:

- **History-backed adherence:** measures whether Claude actually followed your rules across real sessions, not just whether they sound good.
- **Broader instruction surface:** analyzes scoped rules, agents, skills, `AGENTS.md`, and Cursor-style rule files — not just a single `CLAUDE.md`.
- **Local and automatable:** CLI and MCP server with JSON output and CI support.
- **Placement advice:** suggests where rules belong — global memory, scoped rule, skill, subagent, hook, or linter config.

Use the official plugin for in-Claude memory editing. Use alignkit if you want deeper static analysis, broader instruction-format coverage, or evidence about whether your instruction system is working in practice. Use both if that fits your workflow.

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

## Current limitations

- **`check` is still an evidence system, not an enforcement system.** It can tell you what likely happened in observed sessions, but it cannot prove compliance in the abstract.
- **The auto-classifier still puts many rules in a catch-all "behavioral" bucket.** Rules with unusual phrasing or domain-specific language may not be classified correctly. This affects which verification strategy is used. `--deep` compensates for part of this.
- **The parser is intentionally conservative.** It is much better with mixed instruction files than before, but prose-heavy workflow guidance can still be missed if it does not read clearly like an instruction.
- **Token counting is approximate.** We use the GPT-4 tokenizer (`cl100k_base`), not Claude's. Counts may differ by up to ~20%.
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
| `optimize --deep` | Rule text + adherence data for LLM-powered consolidation. |

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
