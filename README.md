# alignkit

Instruction intelligence for coding agents.

You write a CLAUDE.md to control how AI coding agents work in your codebase. But you have no way to know if your rules are well-structured, if the agent actually follows them, or which rules are wasting tokens. alignkit gives you that visibility.

```bash
npx alignkit
```

## What it does

**`lint`** finds problems in your instruction files before the agent ever sees them — vague rules, contradictions, redundancies, stale version references, and poor ordering.

**`lint --deep`** uses an LLM to go further: predicts which rules the agent is likely to ignore, identifies important behaviors your rules don't cover, and suggests how to consolidate related rules into fewer, stronger ones.

**`check`** reads your Claude Code session history and measures whether each rule was actually followed. With `--deep`, it uses an LLM to evaluate rules that can't be verified by pattern matching alone — going from ~25% rule coverage to ~85%.

## Quick start

```bash
# Analyze your instruction file (zero config, free)
npx alignkit

# LLM-powered deep analysis (~$0.05, requires ANTHROPIC_API_KEY)
npx alignkit lint --deep

# Check which rules your agent actually follows
npx alignkit check

# Check with LLM evaluation for rules pattern matching can't cover
npx alignkit check --deep
```

## What the output looks like

### `alignkit lint`

Finds structural issues — no API key needed, runs instantly.

```
CLAUDE.md — 34 rules, ~1,200 tokens (estimated)

  ⚠ VAGUE       "Be careful with state management"
     No verifiable behavior. Rewrite as: "Always/Never [action] when [condition]"

  ⚠ CONFLICT    "Always use named exports" contradicts
     "Use default exports for React components"

  ⚠ REDUNDANT   "Always show user feedback for errors" is similar to
     "Always have onError handler with user feedback"

  ⚠ STALE       References "React 18" — verify current

  ⚠ ORDERING    5 high-priority rules appear after line 80.
     Agents attend more to early content.

HEALTH  34 rules, 22 auto-verifiable, 3 vague, 1 conflict, 1 redundant
TOKENS  ~1,200 (~0.6% of context window). Recommended: under 2,000.

QUICK WINS
  → Merge 1 redundant rule pair → run alignkit optimize
  → Move 5 high-priority rules to top of file → run alignkit optimize
```

### `alignkit lint --deep`

Everything above, plus LLM-powered analysis of your rules against your project structure.

```
EFFECTIVENESS PREDICTIONS
  ⚠ LOW     "Prefer composition over inheritance"
           Too abstract — doesn't specify when/how to apply in this project.
           Rewrite: "Use hooks and composition for shared behavior between
           components. Avoid class-based inheritance for React components."

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

Measures per-rule adherence from your Claude Code session history. `--deep` uses an LLM to evaluate rules that pattern matching can't cover.

```
CLAUDE.md last modified: 5 days ago
Found 14 sessions since then.

 "Use pnpm, not npm"                     9/9       100% ✓    high    auto:bash-keyword
 "Run tests before committing"           12/14      86% ✓    medium  auto:bash-sequence
 "TypeScript strict mode"                14/14     100% ✓    medium  llm-judge
 "Prisma for all data access"            11/14      79% ~    medium  llm-judge
 "Add JSDoc to public functions"          2/7       29% ✗    medium  llm-judge

 5 rules verified · 2 unverifiable
```

Every number includes sample size, verification method, and confidence level.

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

`--ci` returns exit code 1 when diagnostics are found. Without `--ci`, lint always exits 0.

## How it works

**Lint** parses your instruction file into individual rules, classifies each by type (tool-constraint, code-structure, process-ordering, style-guidance, behavioral), and runs six deterministic checks: vague language detection, near-duplicate detection, conflict detection, version reference flagging, ordering analysis, and token counting.

**Lint --deep** sends rule text and project metadata (directory names, dependency names — not source code) to the Anthropic API for effectiveness prediction, coverage gap analysis, and consolidation suggestions.

**Check** reads Claude Code session logs from `~/.claude/projects/`, extracts tool_use actions (Bash commands, file writes, edits, reads), and verifies each rule using pattern-matching strategies:

| Strategy | What it checks | Confidence |
|---|---|---|
| `bash-keyword` | Tool/command usage in Bash actions | High |
| `bash-sequence` | Temporal ordering of commands | Medium |
| `file-pattern` | File paths in Write/Edit actions | High |
| `heuristic-structure` | Code patterns via regex | Medium |

**Check --deep** sends unresolved rules + session action summaries to the LLM for evaluation, covering rules that pattern matching can't handle.

## Current strengths

- **lint works well across a broad range of instruction files.** Finds real issues on real files. Tested against files from 6 to 387 lines.
- **lint --deep often produces genuinely useful insights.** Coverage gap analysis correctly identifies missing rules based on your project's actual dependencies and directory structure. Consolidation suggestions produce real token savings with concrete merged text.
- **check --deep dramatically improves coverage.** Pattern matching alone covers ~25% of rules in a typical CLAUDE.md. With LLM evaluation, coverage jumps to ~85%. The LLM correctly evaluates rules like "TypeScript strict mode" and "Agent configs are data, not imperative code" that regex can't touch.
- **Transparent about confidence.** Every adherence number shows its sample size, verification method, and confidence level. No numbers without context.

## Current limitations

- **The auto-classifier puts many rules in a catch-all "behavioral" bucket.** Rules with unusual phrasing or domain-specific language may not be classified correctly. This affects which verification strategy is used. `--deep` compensates for this.
- **The parser extracts some documentation as rules.** Instruction files that mix documentation heavily with directives (architecture descriptions, command references) may have inflated rule counts. The parser filters out code fences, bold-prefixed descriptions, and command references, but some noise remains.
- **Token counting is approximate.** We use the GPT-4 tokenizer (`cl100k_base`), not Claude's. Counts may differ by up to ~20%.
- **watch, report, and status need accumulated data to be useful.** They work correctly but produce thin output until you have multiple sessions. These features mature over time.
- **Session-based features only work with Claude Code.** Cursor, Windsurf, and other agent session formats are not supported for check/watch/report/optimize. Lint works on all instruction file formats.

## Format support

| Format | lint | lint --deep | check / watch / report / optimize |
|---|---|---|---|
| CLAUDE.md | Yes | Yes | Yes (Claude Code sessions) |
| AGENTS.md | Yes | Yes | Yes (Claude Code sessions) |
| .cursorrules | Yes | Yes | Not yet |
| .cursor/rules | Yes | Yes | Not yet |

## Privacy

**By default, alignkit is fully local.** `lint`, `check`, `watch`, `status`, `report`, and `optimize` never make network requests. Your instruction files, session logs, and source code stay on your machine.

**Two opt-in features make API calls:**

| Feature | What's sent to the Anthropic API |
|---|---|
| `--deep` (lint) | Rule text + project metadata (directory names, dependency names). **Not** source code. |
| `--deep` (check) | Rule text + session action summaries (commands run, files written). |

Both require `ANTHROPIC_API_KEY`. If you never set it, nothing ever leaves your machine.

No telemetry. No analytics. No phone-home.

## Configuration

Optional. Everything works with zero configuration.

```jsonc
// .alignkit.config.jsonc
{
  "instructionFile": "./CLAUDE.md",
  "thresholds": { "tokenBudget": 2000, "flagBelow": 20 },
  "contextWindow": 200000,
  "rules": {
    "always-add-error-handling": {
      "verifier": "custom",
      "check": "grep:catch|try|\\.catch in write:src/routes/**"
    }
  }
}
```

## Requirements

- Node.js 18+
- Claude Code session history (for check/watch/report/optimize)
- `ANTHROPIC_API_KEY` (only for `--deep`)

## License

MIT
