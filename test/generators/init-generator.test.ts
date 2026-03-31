import { describe, it, expect } from 'vitest';
import { generateFromTemplates } from '../../src/generators/init-generator.js';
import type { DetectedStack } from '../../src/generators/stack-detector.js';

function makeStack(overrides: Partial<DetectedStack> = {}): DetectedStack {
  return {
    packageManager: null,
    framework: null,
    language: null,
    testRunner: null,
    database: null,
    styling: null,
    linter: null,
    monorepo: null,
    scripts: {},
    ...overrides,
  };
}

describe('generateFromTemplates', () => {
  it('generates Code section for TypeScript', () => {
    const stack = makeStack({ language: 'typescript' });
    const output = generateFromTemplates(stack);
    expect(output).toContain('## Code');
    expect(output).toContain('TypeScript strict mode');
  });

  it('generates Next.js rules', () => {
    const stack = makeStack({ framework: 'nextjs' });
    const output = generateFromTemplates(stack);
    expect(output).toContain('server components');
    expect(output).toContain('App Router');
  });

  it('generates Prisma rules', () => {
    const stack = makeStack({ database: 'prisma' });
    const output = generateFromTemplates(stack);
    expect(output).toContain('Prisma');
    expect(output).toContain('no raw SQL');
  });

  it('generates Commands from scripts', () => {
    const stack = makeStack({
      packageManager: 'pnpm',
      scripts: { dev: 'next dev', build: 'next build', test: 'vitest' },
      testRunner: 'vitest',
    });
    const output = generateFromTemplates(stack);
    expect(output).toContain('## Commands');
    expect(output).toContain('`pnpm dev`');
    expect(output).toContain('`pnpm build`');
    expect(output).toContain('`pnpm test`');
    expect(output).toContain('vitest');
  });

  it('uses npm run prefix for npm', () => {
    const stack = makeStack({
      packageManager: 'npm',
      scripts: { dev: 'next dev' },
    });
    const output = generateFromTemplates(stack);
    expect(output).toContain('`npm run dev`');
  });

  it('always includes Process section with universal rules', () => {
    const stack = makeStack();
    const output = generateFromTemplates(stack);
    expect(output).toContain('## Process');
    expect(output).toContain('Run tests before committing');
    expect(output).toContain('Never commit .env');
  });

  it('puts Code before Process before Commands', () => {
    const stack = makeStack({
      language: 'typescript',
      packageManager: 'pnpm',
      scripts: { dev: 'next dev' },
    });
    const output = generateFromTemplates(stack);
    const codeIdx = output.indexOf('## Code');
    const processIdx = output.indexOf('## Process');
    const commandsIdx = output.indexOf('## Commands');
    expect(codeIdx).toBeLessThan(processIdx);
    expect(processIdx).toBeLessThan(commandsIdx);
  });

  it('omits Commands section when no scripts', () => {
    const stack = makeStack({ language: 'typescript' });
    const output = generateFromTemplates(stack);
    expect(output).not.toContain('## Commands');
  });

  it('omits Code section when no language/framework/database detected', () => {
    const stack = makeStack({ packageManager: 'npm', scripts: { dev: 'node server.js' } });
    const output = generateFromTemplates(stack);
    expect(output).not.toContain('## Code');
  });

  it('skips trivial scripts like prebuild', () => {
    const stack = makeStack({
      packageManager: 'npm',
      scripts: { prebuild: 'echo pre', build: 'tsc', postinstall: 'echo done' },
    });
    const output = generateFromTemplates(stack);
    expect(output).not.toContain('prebuild');
    expect(output).not.toContain('postinstall');
    expect(output).toContain('build');
  });

  it('generates monorepo rules for turborepo', () => {
    const stack = makeStack({ monorepo: 'turborepo' });
    const output = generateFromTemplates(stack);
    expect(output).toContain('turbo');
  });

  it('generates full stack output', () => {
    const stack = makeStack({
      packageManager: 'pnpm',
      language: 'typescript',
      framework: 'nextjs',
      testRunner: 'vitest',
      database: 'prisma',
      styling: 'tailwind',
      linter: 'eslint',
      scripts: { dev: 'next dev', build: 'next build', test: 'vitest', lint: 'eslint .' },
    });
    const output = generateFromTemplates(stack);

    // Verify all three sections exist
    expect(output).toContain('## Code');
    expect(output).toContain('## Process');
    expect(output).toContain('## Commands');

    // Verify key rules
    expect(output).toContain('TypeScript strict mode');
    expect(output).toContain('server components');
    expect(output).toContain('Prisma');
    expect(output).toContain('Tailwind');
    expect(output).toContain('Run tests before committing');

    // Verify line count is reasonable (under 40)
    const lineCount = output.split('\n').filter((l) => l.trim()).length;
    expect(lineCount).toBeLessThanOrEqual(40);
  });

  it('ends with a trailing newline', () => {
    const stack = makeStack({ language: 'typescript' });
    const output = generateFromTemplates(stack);
    expect(output.endsWith('\n')).toBe(true);
  });
});
