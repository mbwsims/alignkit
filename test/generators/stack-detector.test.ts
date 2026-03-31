import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectStack } from '../../src/generators/stack-detector.js';

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'alignkit-stack-'));
}

describe('detectStack', () => {
  it('detects pnpm from lockfile', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    writeFileSync(join(dir, 'package.json'), '{}');
    const stack = detectStack(dir);
    expect(stack.packageManager).toBe('pnpm');
  });

  it('detects yarn from lockfile', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'yarn.lock'), '');
    writeFileSync(join(dir, 'package.json'), '{}');
    const stack = detectStack(dir);
    expect(stack.packageManager).toBe('yarn');
  });

  it('detects npm from lockfile', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    writeFileSync(join(dir, 'package.json'), '{}');
    const stack = detectStack(dir);
    expect(stack.packageManager).toBe('npm');
  });

  it('detects typescript from tsconfig.json', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'tsconfig.json'), '{}');
    writeFileSync(join(dir, 'package.json'), '{}');
    const stack = detectStack(dir);
    expect(stack.language).toBe('typescript');
  });

  it('detects python from pyproject.toml', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'pyproject.toml'), '');
    const stack = detectStack(dir);
    expect(stack.language).toBe('python');
  });

  it('detects Next.js framework', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { next: '^14.0.0', react: '^18.0.0' },
    }));
    const stack = detectStack(dir);
    expect(stack.framework).toBe('nextjs');
  });

  it('detects vitest test runner', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      devDependencies: { vitest: '^1.0.0' },
    }));
    const stack = detectStack(dir);
    expect(stack.testRunner).toBe('vitest');
  });

  it('detects Prisma database', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { '@prisma/client': '^5.0.0' },
    }));
    const stack = detectStack(dir);
    expect(stack.database).toBe('prisma');
  });

  it('detects Tailwind styling', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      devDependencies: { tailwindcss: '^3.0.0' },
    }));
    const stack = detectStack(dir);
    expect(stack.styling).toBe('tailwind');
  });

  it('detects turborepo monorepo', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'turbo.json'), '{}');
    writeFileSync(join(dir, 'package.json'), '{}');
    const stack = detectStack(dir);
    expect(stack.monorepo).toBe('turborepo');
  });

  it('detects eslint linter', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      devDependencies: { eslint: '^8.0.0' },
    }));
    const stack = detectStack(dir);
    expect(stack.linter).toBe('eslint');
  });

  it('reads scripts from package.json', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      scripts: { dev: 'next dev', build: 'next build', test: 'vitest' },
    }));
    const stack = detectStack(dir);
    expect(stack.scripts).toEqual({ dev: 'next dev', build: 'next build', test: 'vitest' });
  });

  it('handles missing package.json gracefully', () => {
    const dir = makeTmpDir();
    const stack = detectStack(dir);
    expect(stack.packageManager).toBeNull();
    expect(stack.framework).toBeNull();
    expect(stack.scripts).toEqual({});
  });

  it('detects full Next.js + Prisma + Tailwind stack', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    writeFileSync(join(dir, 'tsconfig.json'), '{}');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({
      dependencies: { next: '^14', react: '^18', '@prisma/client': '^5' },
      devDependencies: { vitest: '^1', tailwindcss: '^3', eslint: '^8' },
      scripts: { dev: 'next dev', build: 'next build', test: 'vitest', lint: 'eslint .' },
    }));
    const stack = detectStack(dir);
    expect(stack.packageManager).toBe('pnpm');
    expect(stack.language).toBe('typescript');
    expect(stack.framework).toBe('nextjs');
    expect(stack.testRunner).toBe('vitest');
    expect(stack.database).toBe('prisma');
    expect(stack.styling).toBe('tailwind');
    expect(stack.linter).toBe('eslint');
  });
});
