# CLAUDE.md

## Development

- Always use pnpm, not npm or yarn
- Run tests before committing changes
- Use TypeScript strict mode
- Use named exports, not default exports

## Testing

- Write tests using vitest
- Run `pnpm test` to execute the test suite
- Run `pnpm build` before testing CLI commands manually

## Code Style

- Use ESM imports (import/export), not CommonJS (require/module.exports)
- Keep functions small and focused
- Use descriptive variable names
