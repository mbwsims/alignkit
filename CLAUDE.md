# CLAUDE.md

## Tools & Process

- Always use pnpm, not npm or yarn
- Run `pnpm test` before committing — all tests must pass
- Run `pnpm build` before testing CLI commands manually
- Use `pnpm typecheck` to verify types without emitting
- Write tests using vitest
- Mock the Anthropic SDK in tests — never make real API calls

## Code Conventions

- Use TypeScript strict mode — never disable strict checks
- Use named exports, not default exports
- Use ESM imports (`import`/`export`), not CommonJS (`require`/`module.exports`)
- `@anthropic-ai/sdk` must be lazy-loaded — never import it at the top level outside of `src/analyzers/deep-analyzer.ts` and `src/mcp/`

## Architecture

- Parsers (`src/parsers/`) produce `Rule[]` — the rest of the system never touches raw instruction files
- Analyzers (`src/analyzers/`) enrich rules with diagnostics — input and output are both `Rule[]`
- Verifiers (`src/verifiers/`) check rules against session actions — each returns an `Observation`
- CLI commands (`src/cli/`) orchestrate components — they must not contain business logic
- Test files mirror source structure: `src/parsers/foo.ts` → `test/parsers/foo.test.ts`

## Session Data

- Only parse `assistant` lines from JSONL — skip all other line types
- Skip JSONL files with mtime under 2 minutes (active sessions)
- Never store source code or bash commands in history — store only rule IDs, session IDs, and boolean verdicts
