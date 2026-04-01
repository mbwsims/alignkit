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
    expect(result.fileDiagnostics).toEqual([]);
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

  it('auto-discovers .claude/agents files when no runtime memory file exists', () => {
    const agentsDir = join(tmpDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, 'test-runner.md'),
      [
        '---',
        'name: test-runner',
        'description: Use proactively for running tests and fixing failures.',
        '---',
        '',
        'You are an expert in test automation. Focus on running the smallest relevant test coverage first. When you see code changes, run the relevant tests.',
      ].join('\n'),
    );

    const result = lintTool(tmpDir);

    expect(result.file).toBe(join('.claude', 'agents', 'test-runner.md'));
    expect(result.ruleCount).toBeGreaterThan(0);
    expect(result.rules.some((rule) => rule.text.includes('Focus on running'))).toBe(true);
  });

  it('auto-discovers .claude/skills files when no runtime memory file exists', () => {
    const skillDir = join(tmpDir, '.claude', 'skills', 'explain-code');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        '---',
        'name: explain-code',
        'description: Explain code with analogies and diagrams.',
        '---',
        '',
        'When explaining code:',
        '1. Start with an analogy.',
        '2. Draw a simple diagram.',
      ].join('\n'),
    );

    const result = lintTool(tmpDir);

    expect(result.file).toBe(join('.claude', 'skills', 'explain-code', 'SKILL.md'));
    expect(result.ruleCount).toBeGreaterThan(0);
    expect(result.rules.some((rule) => rule.text.includes('Start with an analogy'))).toBe(true);
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

  it('surfaces subagent frontmatter diagnostics separately from rules', () => {
    const agentsDir = join(tmpDir, '.claude', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, 'TestRunner.md'),
      [
        '---',
        'name: TestRunner',
        '---',
        '',
        'You are an expert in test automation. Focus on running the smallest relevant test coverage first.',
      ].join('\n'),
    );

    const result = lintTool(tmpDir, join('.claude', 'agents', 'TestRunner.md'));

    expect(result.fileDiagnostics.some((diagnostic) => diagnostic.code === 'METADATA')).toBe(true);
    expect(result.fileDiagnostics.some((diagnostic) => diagnostic.message.includes('description'))).toBe(true);
    expect(result.quickWins.some((win) => win.includes('metadata'))).toBe(true);
  });

  it('surfaces skill metadata diagnostics separately from rules', () => {
    const skillDir = join(tmpDir, '.claude', 'skills', 'ExplainCode');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      [
        'Always explain code with diagrams and analogies.',
      ].join('\n'),
    );

    const result = lintTool(tmpDir, join('.claude', 'skills', 'ExplainCode', 'SKILL.md'));

    expect(result.fileDiagnostics.some((diagnostic) => diagnostic.code === 'METADATA')).toBe(true);
    expect(result.fileDiagnostics.some((diagnostic) => diagnostic.message.includes('YAML frontmatter'))).toBe(true);
    expect(result.quickWins.some((win) => win.includes('metadata'))).toBe(true);
  });

  it('loads effective Claude memory stack for nested files', () => {
    writeFileSync(join(tmpDir, 'CLAUDE.md'), '- Use pnpm for package management\n');
    writeFileSync(join(tmpDir, 'CLAUDE.local.md'), '- Use the local sandbox\n');
    const subDir = join(tmpDir, 'sub');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(join(subDir, 'CLAUDE.md'), '- Run tests before pushing\n');

    const result = lintTool(tmpDir, join('sub', 'CLAUDE.md'));
    const texts = result.rules.map((rule) => rule.text);

    expect(texts).toContain('Use pnpm for package management');
    expect(texts).toContain('Use the local sandbox');
    expect(texts).toContain('Run tests before pushing');
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

  it('surfaces placement diagnostics and quick wins', () => {
    writeFileSync(
      join(tmpDir, 'CLAUDE.md'),
      [
        '- For `apps/web/**`, use React Server Components by default.',
        '- After every file edit, run eslint --fix on the changed file.',
      ].join('\n'),
    );

    const result = lintTool(tmpDir);

    expect(result.rules.some((rule) =>
      rule.diagnostics.some((diagnostic) =>
        diagnostic.code === 'PLACEMENT' && diagnostic.placement?.target === 'scoped-rule'))).toBe(true);
    expect(result.rules.some((rule) =>
      rule.diagnostics.some((diagnostic) =>
        diagnostic.code === 'PLACEMENT' && diagnostic.placement?.target === 'hook'))).toBe(true);
    expect(result.quickWins.some((win) => win.includes('.claude/rules'))).toBe(true);
    expect(result.quickWins.some((win) => win.includes('hooks'))).toBe(true);
  });
});
