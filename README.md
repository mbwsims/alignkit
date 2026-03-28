# alignkit

Instruction intelligence for coding agents.

alignkit analyzes, measures, and optimizes the instruction files (CLAUDE.md, .cursorrules, AGENTS.md) that control AI coding agents. It tells you which rules are vague, which are being ignored, and how to make your instructions more effective.

```bash
npx alignkit
```

---

## Why

You've written a CLAUDE.md with 40 rules. Some are great. Some are vague. Some contradict each other. Some are consistently ignored by the agent. You have no way to know which is which.

alignkit gives you visibility into what's actually happening:

- **lint** finds structural problems in your instruction files — before the agent ever sees them
- **check** measures per-rule adherence from real Claude Code session history
- **optimize** generates an improved instruction file based on what's actually working

## Quick Start

```bash
# Analyze your instruction file (zero config, zero cost)
npx alignkit

# Same thing, explicit
npx alignkit lint

# Check which rules the agent actually follows
npx alignkit check

# Get a quick pulse on adherence
npx alignkit status

# Watch adherence over time
npx alignkit watch
```

## Commands

### `alignkit lint [file]`

Static analysis of your instruction file. No API key, no session data, no cost.

```
$ alignkit lint

CLAUDE.md — 47 rules, ~3,200 tokens (estimated)

 ✗  VAGUE       "Be careful with state management"
                 No verifiable behavior. Rewrite as: "Always/Never [action] when [condition]"

 ✗  CONFLICT    "Always use named exports" contradicts "Use default exports for React components"

 ✗  REDUNDANT   Rules 15 and 29 express the same constraint differently

 ⚠  STALE       References "Tailwind v3" — verify current

 HEALTH: 47 rules — 31 auto-verifiable, 7 vague, 4 conflicting, 3 redundant, 2 stale
 TOKENS: ~3,200 (~18% of context window). Recommended: under 2,000.
```

**`--deep`** adds LLM-powered analysis (requires `ANTHROPIC_API_KEY`):
- Effectiveness predictions: which rules are likely to be ignored and why
- Coverage gaps: important behaviors your rules don't address
- Consolidation: groups of rules that can merge into fewer, stronger ones
- Concrete rewrites for vague rules, informed by your project structure

```bash
ANTHROPIC_API_KEY=sk-... alignkit lint --deep
```

### `alignkit check [file]`

Measures per-rule adherence from your Claude Code session history. Reads `~/.claude/projects/` — nothing leaves your machine.

```
$ alignkit check

CLAUDE.md last modified: 5 days ago
Found 14 sessions since then.

 "Use pnpm, not npm"                     9/9       100% ✓    high    auto:bash-keyword
 "Run tests before committing"           12/14      86% ✓    medium  auto:bash-sequence
 "Use named exports"                      8/11      73% ~    medium  auto:heuristic-structure
 "Add JSDoc to public functions"          2/7       29% ✗    medium  auto:heuristic-structure
 "Create a branch before changes"         2/14      14% ✗    medium  auto:bash-sequence

 14 rules auto-verified · 2 unverifiable · 1 needs custom check
```

Every number includes the sample size, verification method, and confidence level. No number without context.

### `alignkit watch [file]`

Background daemon that monitors sessions and builds adherence history.

```bash
alignkit watch              # polls every 30 seconds
alignkit watch --interval 60  # custom interval
alignkit watch --quiet      # suppress per-session output
```

### `alignkit status [file]`

Single-line pulse check from history.

```
$ alignkit status

CLAUDE.md  78% adherence across 14 sessions (last 5 days)  ▁▃▅▇▇ trending up
  31 rules tracked · 24 auto-verified · 2 consistently violated · 3 new
```

### `alignkit report [file]`

Trend analysis with actionable recommendations.

```bash
alignkit report             # last 7 days
alignkit report --days 30   # last 30 days
alignkit report --format html  # generates .alignkit/report.html
```

### `alignkit optimize [file]`

Generates an improved instruction file. Conservative by default — flags problems, doesn't delete rules.

```bash
alignkit optimize           # deduplicate, reorder, flag
alignkit optimize --prune   # also remove never-relevant rules
alignkit optimize --deep    # add LLM-powered consolidation
```

Writes `CLAUDE.optimized.md` (never modifies original) and `alignkit-diff.md` (explains every change).

## Format Support

| Format | lint | lint --deep | check/watch/report/optimize |
|---|---|---|---|
| CLAUDE.md | Yes | Yes | Yes |
| AGENTS.md | Yes | Yes | Yes |
| .cursorrules | Yes | Yes | No (no session reader) |
| .cursor/rules | Yes | Yes | No (no session reader) |

## Configuration

Optional. Everything works with zero configuration.

```jsonc
// .alignkit.config.jsonc
{
  "instructionFile": "./CLAUDE.md",
  "thresholds": {
    "tokenBudget": 2000,
    "flagBelow": 20
  },
  "contextWindow": 200000,

  // Custom verifiers for specific rules
  "rules": {
    "always-add-error-handling": {
      "verifier": "custom",
      "check": "grep:catch|try|\\.catch in write:src/routes/**"
    }
  }
}
```

## Privacy

**By default, alignkit is fully local.** The core commands — `lint`, `check`, `watch`, `status`, `report`, `optimize` — never make network requests. Your instruction files, session logs, and source code stay on your machine.

**Two opt-in features make API calls:**

| Feature | What you opt into | What's sent to the Anthropic API |
|---|---|---|
| `--deep` | LLM-powered analysis | Rule text + project metadata (directory names, dependency names). **Not** source code. |
| `llm-judge` (per-rule config) | LLM-based rule verification | Rule text + source code written by the agent. |

Both require you to set `ANTHROPIC_API_KEY` — they literally cannot run without it. If you never set the key, nothing ever leaves your machine.

No telemetry. No analytics. No phone-home. Add `.alignkit/` to your `.gitignore`.

## How It Works

**Lint** parses your instruction file into individual rules, classifies each by type (tool-constraint, code-structure, process-ordering, style-guidance, behavioral, meta), and runs six deterministic checks: vague language detection, near-duplicate detection, lexical conflict detection, version reference flagging, ordering analysis, and token counting.

**Check** reads Claude Code session logs from `~/.claude/projects/`, extracts tool_use actions (Bash commands, file writes, file edits, file reads), and verifies each rule against each session using four strategies:

| Strategy | What it checks | Confidence |
|---|---|---|
| `bash-keyword` | Tool/command usage in Bash actions | High |
| `bash-sequence` | Temporal ordering of commands | Medium |
| `file-pattern` | File paths in Write/Edit actions | High |
| `heuristic-structure` | Code patterns via regex on written content | Medium |

Rules that can't be mapped to a strategy are marked `unmapped`. You can add custom verifiers in the config file.

## Requirements

- Node.js 18+
- Claude Code session history (for check/watch/report/optimize)
- `ANTHROPIC_API_KEY` (only for `--deep` and `llm-judge`)

## License

MIT
