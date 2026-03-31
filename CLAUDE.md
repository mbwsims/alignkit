# CLAUDE.md

## Development

- Always use pnpm, not npm or yarn
- Run `pnpm test` before committing — all 325+ tests must pass
- Run `pnpm build` before testing CLI commands manually
- Use TypeScript strict mode
- Use named exports, not default exports
- Use ESM imports (import/export), not CommonJS (require/module.exports)

## Architecture

- Parsers (`src/parsers/`) convert instruction files into `Rule[]` — the rest of the system never touches raw files
- Analyzers (`src/analyzers/`) enrich rules with diagnostics — they take `Rule[]` and return `Rule[]`
- Verifiers (`src/verifiers/`) check rules against session actions — each returns an `Observation`
- The CLI layer (`src/cli/`) orchestrates parsers, analyzers, verifiers, and reporters — it should not contain business logic
- `@anthropic-ai/sdk` is lazy-loaded — never import it at the top level of non-deep modules

## Testing

- Write tests using vitest
- Test files mirror source structure: `src/parsers/foo.ts` → `test/parsers/foo.test.ts`
- Mock the Anthropic SDK in tests — never make real API calls in the test suite
- When adding a new verifier, add tests for: matched (followed), matched (violated), and not-relevant cases

## Session reader

- Only parse `assistant` lines from JSONL — skip progress, queue-operation, system, user lines
- Skip JSONL files with mtime < 2 minutes (active sessions)
- Never store source code or bash commands in history — only rule IDs, session IDs, and boolean verdicts
