# alignkit Tier 1 (lint) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `alignkit lint` — static analysis of AI coding agent instruction files (CLAUDE.md, .cursorrules, AGENTS.md) via `npx alignkit lint`.

**Architecture:** TypeScript CLI built with `commander`. Parsers extract rules from markdown/plaintext instruction files. Six analyzers run deterministic checks (token count, vague language, duplicates, conflicts, versions, ordering). Results formatted via pluggable reporters (terminal, JSON, markdown). Zero external dependencies beyond npm packages — no LLM calls for the base command.

**Tech Stack:** TypeScript (ESM, Node 18+), commander, js-tiktoken, picocolors, globby, jsonc-parser, vitest

**Spec:** `docs/superpowers/specs/2026-03-26-alignkit-v1-design.md` — Tier 1 sections only (Parsers, Static Analyzer, CLI lint command, Configuration, Project Structure, Key Dependencies)

**Scope of this plan:** Tier 1 only — `alignkit lint` with all six static analyzers and three reporters. `lint --deep` ships as a stub in this plan (prints "not yet implemented") — full LLM-powered analysis is a follow-on task once the base lint is validated. Tier 2 (check/watch/report/optimize/feedback) is a separate plan gated on session fixture capture.

---

## File Structure

```
alignkit/
├── src/
│   ├── cli/
│   │   ├── index.ts              # CLI entry point, commander setup, command routing
│   │   └── lint.ts               # lint command handler: orchestrates parse → analyze → report
│   │
│   ├── parsers/
│   │   ├── types.ts              # Rule, Diagnostic, RuleCategory interfaces
│   │   ├── markdown-parser.ts    # Shared markdown → Rule[] logic (headings, lists, paragraphs)
│   │   ├── claude-md.ts          # CLAUDE.md parser (wraps markdown-parser)
│   │   ├── agents-md.ts          # AGENTS.md parser (wraps markdown-parser)
│   │   ├── cursorrules.ts        # .cursorrules parser (looser heading detection)
│   │   ├── auto-detect.ts        # Scan CWD for instruction files, priority ordering
│   │   ├── classifier.ts         # Keyword → RuleCategory + verifiability mapping
│   │   └── rule-id.ts            # SHA-256 hash + slug generation
│   │
│   ├── analyzers/
│   │   ├── types.ts              # AnalysisResult, analyzer function signature
│   │   ├── token-counter.ts      # js-tiktoken wrapper, context window %
│   │   ├── vague-detector.ts     # Hedging language regex patterns
│   │   ├── duplicate-detector.ts # Jaccard similarity between rule pairs
│   │   ├── conflict-detector.ts  # Negation patterns, tool-category conflicts
│   │   ├── version-flagger.ts    # Version reference regex
│   │   ├── ordering-analyzer.ts  # High-priority rules in bottom half
│   │   └── deep-analyzer.ts      # LLM-powered analysis (--deep), lazy-loads SDK
│   │
│   ├── config/
│   │   └── loader.ts             # .alignkit.config.jsonc + package.json resolution
│   │
│   └── reporters/
│       ├── types.ts              # Reporter interface
│       ├── terminal.ts           # Colored terminal output (picocolors)
│       ├── json.ts               # Machine-readable JSON
│       └── markdown.ts           # Markdown output
│
├── test/
│   ├── fixtures/
│   │   ├── simple.md             # 5 rules, no issues
│   │   ├── compound-rules.md     # Multi-sentence compound rules
│   │   ├── real-world.md         # Copy of a real CLAUDE.md
│   │   └── cursorrules.txt       # .cursorrules format fixture
│   │
│   ├── parsers/
│   │   ├── markdown-parser.test.ts
│   │   ├── classifier.test.ts
│   │   ├── rule-id.test.ts
│   │   └── auto-detect.test.ts
│   │
│   ├── analyzers/
│   │   ├── helpers.ts            # makeRule() test helper
│   │   ├── token-counter.test.ts
│   │   ├── vague-detector.test.ts
│   │   ├── duplicate-detector.test.ts
│   │   ├── conflict-detector.test.ts
│   │   ├── version-flagger.test.ts
│   │   └── ordering-analyzer.test.ts
│   │
│   ├── reporters/
│   │   ├── terminal.test.ts
│   │   └── json.test.ts
│   │
│   └── cli/
│       ├── lint.integration.test.ts
│       └── real-world.integration.test.ts
│
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .gitignore
└── README.md
```

**Key decisions:**
- `markdown-parser.ts` is shared between CLAUDE.md and AGENTS.md parsers (same format, different file names)
- `classifier.ts` is separate from parsers — classification is a distinct concern from extraction
- `rule-id.ts` handles both SHA-256 hash and slug generation — they always travel together
- `config/loader.ts` is isolated so Tier 2 commands can reuse it
- `deep-analyzer.ts` lazy-loads `@anthropic-ai/sdk` — not a hard dependency
- Test fixtures live alongside tests, not in `src/`

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Modify: `.gitignore`
- Create: `src/cli/index.ts` (stub)

- [ ] **Step 1: Create package.json**

```json
{
  "name": "alignkit",
  "version": "0.1.0",
  "description": "Measure, debug, and optimize AI coding agent instruction files",
  "type": "module",
  "bin": {
    "alignkit": "./dist/cli/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "engines": {
    "node": ">=18"
  },
  "keywords": ["ai", "agent", "lint", "claude", "cursor", "instruction"],
  "license": "MIT",
  "files": ["dist"]
}
```

- [ ] **Step 2: Install dependencies**

Run: `pnpm add commander js-tiktoken picocolors globby jsonc-parser && pnpm add -D typescript vitest @types/node`

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Update .gitignore**

Append: `node_modules/`, `dist/`, `.alignkit/`, `*.tsbuildinfo`

- [ ] **Step 6: Create CLI stub**

Create `src/cli/index.ts`:
```typescript
#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();

program
  .name('alignkit')
  .description('Measure, debug, and optimize AI coding agent instruction files')
  .version('0.1.0');

program.parse();
```

- [ ] **Step 7: Verify build and run**

Run: `pnpm build && node dist/cli/index.js --help`
Expected: Help output with name "alignkit" and version "0.1.0"

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts .gitignore src/cli/index.ts
git commit -m "feat: scaffold project with TypeScript, commander, vitest"
```

---

### Task 2: Data Types

**Files:**
- Create: `src/parsers/types.ts`
- Create: `src/analyzers/types.ts`
- Create: `src/reporters/types.ts`

- [ ] **Step 1: Create all type files**

`src/parsers/types.ts` — Rule, Diagnostic, RuleCategory, Verifiability interfaces (from spec data model)

`src/analyzers/types.ts` — TokenAnalysis and LintResult interfaces. LintResult must include these exact fields (consumed by all reporters and the lint command handler):
```typescript
export interface TokenAnalysis {
  tokenCount: number;
  contextWindowPercent: number;
  overBudget: boolean;
  budgetThreshold: number;
}

export interface LintResult {
  file: string;
  rules: Rule[];
  tokenAnalysis: TokenAnalysis;
  discoveredFiles: string[];
}
```
Diagnostics are accessed via `rules[n].diagnostics` — they live on the Rule, not on LintResult.

`src/reporters/types.ts` — Reporter interface with `report(result: LintResult): string`

- [ ] **Step 2: Verify types compile**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/parsers/types.ts src/analyzers/types.ts src/reporters/types.ts
git commit -m "feat: add core data types (Rule, Diagnostic, LintResult, Reporter)"
```

---

### Task 3: Rule ID Generation

**Files:**
- Create: `src/parsers/rule-id.ts`
- Create: `test/parsers/rule-id.test.ts`

- [ ] **Step 1: Write failing tests**

Test: SHA-256 hex string format, whitespace normalization, case normalization, different text produces different IDs. Slug tests: kebab-case conversion, non-alphanumeric stripping, truncation to 60 chars, trimming. Deduplication: appending -2, -3 for collisions.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/parsers/rule-id.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement rule-id.ts**

Uses `node:crypto` createHash for SHA-256. Normalize: lowercase + whitespace collapse. Slug: lowercase, replace non-alphanumeric with hyphens, collapse, trim, truncate 60. `deduplicateSlugs()` for collision handling.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/parsers/rule-id.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/parsers/rule-id.ts test/parsers/rule-id.test.ts
git commit -m "feat: add rule ID (SHA-256) and slug generation"
```

---

### Task 4: Rule Classifier

**Files:**
- Create: `src/parsers/classifier.ts`
- Create: `test/parsers/classifier.test.ts`

- [ ] **Step 1: Write failing tests**

Test all six categories: tool-constraint (pnpm, jest, docker), code-structure (export, interface), process-ordering (before+run), style-guidance (clean, meaningful), behavioral (think, step by step), meta (this file, codebase). Test priority order (tool > style when both match). Test verifiability mapping. Test default to behavioral.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/parsers/classifier.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement classifier.ts**

Regex patterns per category. Priority array: tool-constraint > code-structure > process-ordering > meta > style-guidance > behavioral. First match wins. Verifiability map: auto for tool/code/process, unverifiable for style/behavioral, user-config for meta.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/parsers/classifier.test.ts`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/parsers/classifier.ts test/parsers/classifier.test.ts
git commit -m "feat: add rule classifier with keyword-based category detection"
```

---

### Task 5: Markdown Parser

**Files:**
- Create: `src/parsers/markdown-parser.ts`
- Create: `test/parsers/markdown-parser.test.ts`
- Create: `test/fixtures/simple.md`
- Create: `test/fixtures/compound-rules.md`

- [ ] **Step 1: Create test fixtures**

`simple.md`: headings + list items + normative paragraph (5 rules)
`compound-rules.md`: compound sentences, code fence to skip, explanatory paragraph to skip, conditional sentence pair to keep together

- [ ] **Step 2: Write failing tests**

Tests: extracts list items, extracts normative paragraphs, records section headings, records line numbers, skips code fences, skips explanatory paragraphs, splits compound rules with independent imperatives, keeps dependent sentences together, assigns IDs and slugs, classifies rules, initializes empty diagnostics. Additional compound-splitting tests: sentence pair where one half starts with a non-listed imperative like "Ensure" (should NOT split — only split on spec's listed verbs: Always/Never/Use/Run/Create/Prefer), and a pair sharing a conditional clause "When X, do Y. Also do Z" (should NOT split because they share the "When" condition).

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- test/parsers/markdown-parser.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement markdown-parser.ts**

Line-by-line processing: toggle code fences, extract headings as sections, extract list items, accumulate paragraphs and flush on blank lines (only keep normative ones). Compound splitting: split on sentence boundaries only when BOTH sentences start with or contain one of the spec's listed independent imperative verbs (Always/Never/Use/Run/Create/Prefer) AND the first sentence does NOT start with a conditional clause (When/If/For/During). The verb list is exhaustive for v1 — do not expand it without updating tests. Build Rule objects with generateRuleId, generateSlug (deduplicated), classifyRule.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test -- test/parsers/markdown-parser.test.ts`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/parsers/markdown-parser.ts test/parsers/markdown-parser.test.ts test/fixtures/simple.md test/fixtures/compound-rules.md
git commit -m "feat: add markdown parser with compound rule splitting"
```

---

### Task 6: File Format Parsers + Auto-Detection

**Files:**
- Create: `src/parsers/claude-md.ts`
- Create: `src/parsers/agents-md.ts`
- Create: `src/parsers/cursorrules.ts`
- Create: `src/parsers/auto-detect.ts`
- Create: `test/parsers/auto-detect.test.ts`
- Create: `test/fixtures/cursorrules.txt`

- [ ] **Step 1: Create cursorrules fixture**

Plain text with normative statements, no headings.

- [ ] **Step 2: Write failing tests for auto-detect**

Tests: finds CLAUDE.md at root, finds nested CLAUDE.md files in subdirectories, finds .cursorrules, finds .cursor/rules, returns primary first by priority (CLAUDE.md > .cursorrules > AGENTS.md > .cursor/rules), returns empty when no files found. parseInstructionFile: parses CLAUDE.md, parses .cursorrules, parses .cursor/rules. Additional test: discovery returns ALL found files (not just primary) — verify that when root CLAUDE.md + nested src/api/CLAUDE.md + AGENTS.md all exist, all three are in the returned list.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm test -- test/parsers/auto-detect.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement format parsers**

`claude-md.ts`, `agents-md.ts`: thin wrappers around `parseMarkdown`.
`cursorrules.ts`: wraps `parseMarkdown` (handles paragraph-style rules).

- [ ] **Step 5: Implement auto-detect.ts**

Uses `globbySync` to find files matching all four patterns: `**/CLAUDE.md`, `**/AGENTS.md`, `**/.cursorrules`, `**/.cursor/rules`. Sort: root files by priority first (CLAUDE.md > .cursorrules > AGENTS.md > .cursor/rules), nested files alphabetically. `parseInstructionFile` dispatches by filename to the correct parser. The lint command handler (Task 10) prints a discovery line when multiple files are found: "Found N instruction files: ./CLAUDE.md (root), ./src/api/CLAUDE.md, ./AGENTS.md".

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test -- test/parsers/auto-detect.test.ts`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/parsers/claude-md.ts src/parsers/agents-md.ts src/parsers/cursorrules.ts src/parsers/auto-detect.ts test/parsers/auto-detect.test.ts test/fixtures/cursorrules.txt
git commit -m "feat: add format parsers and instruction file auto-detection"
```

---

### Task 7: Analyzers (all six)

**Files:**
- Create: `src/analyzers/token-counter.ts`
- Create: `src/analyzers/vague-detector.ts`
- Create: `src/analyzers/duplicate-detector.ts`
- Create: `src/analyzers/conflict-detector.ts`
- Create: `src/analyzers/version-flagger.ts`
- Create: `src/analyzers/ordering-analyzer.ts`
- Create: `test/analyzers/helpers.ts`
- Create: `test/analyzers/token-counter.test.ts`
- Create: `test/analyzers/vague-detector.test.ts`
- Create: `test/analyzers/duplicate-detector.test.ts`
- Create: `test/analyzers/conflict-detector.test.ts`
- Create: `test/analyzers/version-flagger.test.ts`
- Create: `test/analyzers/ordering-analyzer.test.ts`

Each analyzer: takes `Rule[]`, returns `Rule[]` with diagnostics added. Pattern: immutable — returns new array, doesn't mutate input.

- [ ] **Step 1: Create test helper**

`test/analyzers/helpers.ts`: `makeRule(text, overrides?)` factory that returns a valid `Rule` with defaults.

- [ ] **Step 2: Write all analyzer tests**

- token-counter: positive count, context window %, over/under budget
- vague-detector: flags "be careful", "try to"; does not flag concrete rules
- duplicate-detector: flags near-duplicate pairs; does not flag dissimilar
- conflict-detector: flags negation pairs, tool conflicts; does not flag unrelated
- version-flagger: flags `v3`, `18.2`; does not flag version-free rules
- ordering-analyzer: flags high-priority rules in bottom half; does not flag top-half

- [ ] **Step 3: Run tests to verify they all fail**

Run: `pnpm test -- test/analyzers/`
Expected: All FAIL

- [ ] **Step 4: Implement all six analyzers**

- `token-counter.ts`: js-tiktoken with `cl100k_base` encoding (NOT model alias), returns TokenAnalysis
- `vague-detector.ts`: regex array, add VAGUE diagnostic on match
- `duplicate-detector.ts`: Jaccard similarity (tokenize → word sets → intersection/union), threshold 0.6
- `conflict-detector.ts`: tool group detection + negation pair detection
- `version-flagger.ts`: version regex patterns, add STALE diagnostic
- `ordering-analyzer.ts`: compute midpoint, flag high-priority categories in bottom half

- [ ] **Step 5: Run all analyzer tests**

Run: `pnpm test -- test/analyzers/`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add src/analyzers/ test/analyzers/
git commit -m "feat: add six static analyzers (tokens, vague, duplicates, conflicts, versions, ordering)"
```

---

### Task 8: Reporters (Terminal + JSON + Markdown)

**Files:**
- Create: `src/reporters/terminal.ts`
- Create: `src/reporters/json.ts`
- Create: `src/reporters/markdown.ts`
- Create: `test/reporters/terminal.test.ts`
- Create: `test/reporters/json.test.ts`

- [ ] **Step 1: Write failing tests**

- JSON reporter: outputs valid JSON, includes rule count, includes token analysis, includes diagnostics
- Terminal reporter: includes file name, shows diagnostic codes, shows health summary

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test -- test/reporters/`
Expected: FAIL

- [ ] **Step 3: Implement reporters**

- `terminal.ts`: uses picocolors for colored output. Header with file name + rule count + tokens. Diagnostics with severity icons (red X / yellow warning). Health summary line. Token summary line.
- `json.ts`: structured JSON with file, ruleCount, tokenAnalysis, diagnostics array, rules array, discoveredFiles.
- `markdown.ts`: heading + stats + diagnostics table.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- test/reporters/`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/reporters/ test/reporters/
git commit -m "feat: add terminal, JSON, and markdown reporters"
```

---

### Task 9: Config Loader

**Files:**
- Create: `src/config/loader.ts`

- [ ] **Step 1: Implement config loader**

Reads `.alignkit.config.jsonc` (using `jsonc-parser`) or `package.json` `alignkit` key. Returns `AgentlintConfig` with optional fields: instructionFile, rules, thresholds, contextWindow. Returns empty object if no config found.

- [ ] **Step 2: Verify it compiles**

Run: `pnpm build`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/config/loader.ts
git commit -m "feat: add config loader (JSONC + package.json)"
```

---

### Task 10: lint Command + CLI Wiring

**Files:**
- Create: `src/cli/lint.ts`
- Modify: `src/cli/index.ts`
- Create: `src/analyzers/deep-analyzer.ts` (stub)
- Create: `test/cli/lint.integration.test.ts`

- [ ] **Step 1: Write integration test**

Tests use `execFileSync` (not `exec`) to run `node dist/cli/index.js lint <fixture>`. Note: integration tests against `dist/` cannot run until the build step — write them first, but verify them only after `pnpm build` in Step 5 (don't try to "verify they fail" — they'll throw process errors, not clean test failures).

Test cases: runs against fixture and exits 0, JSON output is valid, markdown output contains header, auto-detect handles missing files with exit 1. Additionally: test `--all` flag by creating a temp directory with two instruction files (CLAUDE.md + AGENTS.md), running `alignkit lint --all`, and asserting the JSON output contains results for both files.

- [ ] **Step 2: Implement lint.ts command handler**

Orchestrates: load config → discover files → parse → run all 6 analyzers → count tokens → format via reporter → output. Handles --format (terminal/json/markdown), --all (analyze all discovered files), --deep (stub message). Uses `registerLintCommand(program)` pattern.

- [ ] **Step 3: Create deep-analyzer.ts stub**

Checks for `ANTHROPIC_API_KEY`, prints "not yet implemented" message. Lazy-loads SDK.

- [ ] **Step 4: Wire lint command into CLI index.ts**

Import `registerLintCommand`, call it on program.

- [ ] **Step 5: Build and run integration tests**

Run: `pnpm build && pnpm test -- test/cli/lint.integration.test.ts`
Expected: All PASS

- [ ] **Step 6: Manual smoke test**

Run: `node dist/cli/index.js lint test/fixtures/simple.md` — verify terminal output
Run: `node dist/cli/index.js lint test/fixtures/simple.md --format json` — verify JSON

- [ ] **Step 7: Commit**

```bash
git add src/cli/ src/analyzers/deep-analyzer.ts test/cli/lint.integration.test.ts
git commit -m "feat: wire lint command with all analyzers and reporters"
```

---

### Task 11: End-to-End Test with Real CLAUDE.md

**Files:**
- Create: `test/fixtures/real-world.md`
- Create: `test/cli/real-world.integration.test.ts`

- [ ] **Step 1: Copy real CLAUDE.md as fixture**

Copy content of `/Users/msims/Documents/GitHub/galaxi/CLAUDE.md` into `test/fixtures/real-world.md`.

- [ ] **Step 2: Write end-to-end test**

Tests: parses without crashing, reasonable rule count (not over-fragmented: >3 and <100), produces token count, terminal output contains expected sections (rules, tokens, HEALTH).

- [ ] **Step 3: Build and run**

Run: `pnpm build && pnpm test -- test/cli/real-world.integration.test.ts`
Expected: All PASS

- [ ] **Step 4: Review terminal output manually**

Run: `node dist/cli/index.js lint test/fixtures/real-world.md`
Inspect output quality. Fix any issues found.

- [ ] **Step 5: Commit**

```bash
git add test/fixtures/real-world.md test/cli/real-world.integration.test.ts
git commit -m "test: add end-to-end test with real CLAUDE.md fixture"
```

---

### Task 12: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 2: Build and type check**

Run: `pnpm build && pnpm typecheck`
Expected: No errors

- [ ] **Step 3: Smoke test all output formats and flags**

```bash
node dist/cli/index.js lint test/fixtures/real-world.md
node dist/cli/index.js lint test/fixtures/real-world.md --format json
node dist/cli/index.js lint test/fixtures/real-world.md --format markdown
node dist/cli/index.js lint --all   # from a directory with multiple fixtures
```

- [ ] **Step 4: Verify error handling for missing files**

Run from `/tmp`: `node <path>/dist/cli/index.js lint`
Expected: "No instruction files found." + exit 1

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final verification for Tier 1 lint"
```
