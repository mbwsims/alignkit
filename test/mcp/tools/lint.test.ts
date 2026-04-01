import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { lintTool } from '../../../src/mcp/tools/lint.js';

describe('lintTool', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `alignkit-lint-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns correct structure with rules and diagnostics', () => {
    writeFileSync(
      join(tmpDir, 'CLAUDE.md'),
      [
        '# Instructions',
        '',
        '- Always use pnpm, not npm',
        '- Be careful with error handling',
        '- Run tests before committing',
      ].join('\n'),
    );

    const result = lintTool(tmpDir);

    expect(result.file).toBe('CLAUDE.md');
    expect(result.ruleCount).toBeGreaterThan(0);
    expect(result.rules).toBeInstanceOf(Array);
    expect(result.rules.length).toBe(result.ruleCount);

    // Each rule has the expected shape
    for (const rule of result.rules) {
      expect(rule).toHaveProperty('text');
      expect(rule).toHaveProperty('category');
      expect(rule).toHaveProperty('verifiability');
      expect(rule).toHaveProperty('diagnostics');
      expect(rule.diagnostics).toBeInstanceOf(Array);
    }

    // Token analysis has expected shape
    expect(result.tokenAnalysis).toHaveProperty('tokenCount');
    expect(result.tokenAnalysis).toHaveProperty('contextWindowPercent');
    expect(result.tokenAnalysis).toHaveProperty('overBudget');
    expect(result.tokenAnalysis.tokenCount).toBeGreaterThan(0);

    // Project context has expected shape
    expect(result.projectContext).toHaveProperty('dependencies');
    expect(result.projectContext).toHaveProperty('tsconfig');
    expect(result.projectContext).toHaveProperty('directoryTree');

    // Quick wins is an array
    expect(result.quickWins).toBeInstanceOf(Array);
  });

  it('detects vague rules and includes VAGUE diagnostic', () => {
    writeFileSync(
      join(tmpDir, 'CLAUDE.md'),
      [
        '# Rules',
        '',
        '- Be careful with state management',
      ].join('\n'),
    );

    const result = lintTool(tmpDir);

    const vagueRule = result.rules.find((r) => r.text.includes('Be careful'));
    expect(vagueRule).toBeDefined();
    expect(vagueRule!.diagnostics.some((d) => d.code === 'VAGUE')).toBe(true);
  });

  it('auto-discovers instruction files when no file is specified', () => {
    writeFileSync(
      join(tmpDir, 'CLAUDE.md'),
      '- Use TypeScript strict mode\n',
    );

    const result = lintTool(tmpDir);

    expect(result.file).toBe('CLAUDE.md');
    expect(result.ruleCount).toBeGreaterThan(0);
  });

  it('uses explicit file path when provided', () => {
    const subDir = join(tmpDir, 'sub');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      join(subDir, 'CLAUDE.md'),
      '- Run tests before pushing\n',
    );

    const result = lintTool(tmpDir, join('sub', 'CLAUDE.md'));

    expect(result.file).toBe(join('sub', 'CLAUDE.md'));
    expect(result.ruleCount).toBeGreaterThan(0);
  });

  it('returns empty result when no instruction files found', () => {
    const result = lintTool(tmpDir);

    expect(result.file).toBe('(none)');
    expect(result.ruleCount).toBe(0);
    expect(result.rules).toHaveLength(0);
    expect(result.quickWins).toContain(
      'No instruction files found. Create a CLAUDE.md to get started.',
    );
  });

  it('collects project context including dependencies', () => {
    writeFileSync(
      join(tmpDir, 'CLAUDE.md'),
      '- Always use named exports\n',
    );
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({
        dependencies: { react: '^18.0.0' },
        devDependencies: { vitest: '^1.0.0' },
      }),
    );

    const result = lintTool(tmpDir);

    expect(result.projectContext.dependencies).toContain('react');
    expect(result.projectContext.dependencies).toContain('vitest');
  });

  it('computes quick wins for vague rules', () => {
    writeFileSync(
      join(tmpDir, 'CLAUDE.md'),
      [
        '- Use TypeScript when appropriate',
        '- Always consider performance tradeoffs',
      ].join('\n'),
    );

    const result = lintTool(tmpDir);

    const vagueWin = result.quickWins.find((w) => w.includes('vague'));
    expect(vagueWin).toBeDefined();
  });
});
