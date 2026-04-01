import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadEffectiveInstructionGraph,
  loadInstructionGraph,
} from '../../src/parsers/instruction-loader.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `alignkit-loader-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(root: string, relPath: string, content: string): string {
  const absPath = join(root, relPath);
  mkdirSync(join(absPath, '..'), { recursive: true });
  writeFileSync(absPath, content, 'utf8');
  return absPath;
}

describe('loadInstructionGraph', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads rules from imported files', () => {
    const rootFile = writeFile(
      tmpDir,
      'CLAUDE.md',
      [
        '# Rules',
        '',
        '- Use pnpm, not npm.',
        '- See @docs/git.md for git workflow.',
        '',
      ].join('\n'),
    );
    writeFile(
      tmpDir,
      'docs/git.md',
      [
        '# Git Rules',
        '',
        '- Run tests before committing.',
        '',
      ].join('\n'),
    );

    const graph = loadInstructionGraph(rootFile);
    const texts = graph.rules.map((rule) => rule.text);

    expect(texts).toContain('Use pnpm, not npm.');
    expect(texts).toContain('Run tests before committing.');
    expect(graph.loadedFiles).toHaveLength(2);
  });

  it('follows nested imports and avoids cycles', () => {
    const rootFile = writeFile(
      tmpDir,
      'CLAUDE.md',
      '- @docs/one.md\n',
    );
    writeFile(tmpDir, 'docs/one.md', '- @two.md\n- Always use TypeScript.\n');
    writeFile(tmpDir, 'docs/two.md', '- @../CLAUDE.md\n- Never commit secrets.\n');

    const graph = loadInstructionGraph(rootFile);
    const texts = graph.rules.map((rule) => rule.text);

    expect(texts).toContain('Always use TypeScript.');
    expect(texts).toContain('Never commit secrets.');
    expect(graph.loadedFiles).toHaveLength(3);
  });

  it('ignores import-like references inside code fences and inline code', () => {
    const rootFile = writeFile(
      tmpDir,
      'CLAUDE.md',
      [
        '# Rules',
        '',
        '- Use pnpm, not npm.',
        '- Reference `@docs/ignored.md` in docs.',
        '```md',
        '@docs/also-ignored.md',
        '```',
        '- See @docs/real.md for testing rules.',
        '',
      ].join('\n'),
    );
    writeFile(tmpDir, 'docs/real.md', '- Run tests before committing.\n');
    writeFile(tmpDir, 'docs/ignored.md', '- Never parse this rule.\n');
    writeFile(tmpDir, 'docs/also-ignored.md', '- Ignore this too.\n');

    const graph = loadInstructionGraph(rootFile);
    const texts = graph.rules.map((rule) => rule.text);

    expect(texts).toContain('Use pnpm, not npm.');
    expect(texts).toContain('Run tests before committing.');
    expect(texts).not.toContain('Never parse this rule.');
    expect(texts).not.toContain('Ignore this too.');
    expect(graph.loadedFiles).toHaveLength(2);
  });
});

describe('loadEffectiveInstructionGraph', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stacks ancestor CLAUDE.md and CLAUDE.local.md files for nested targets', () => {
    writeFile(tmpDir, 'CLAUDE.md', '- Use pnpm for package management.\n');
    writeFile(tmpDir, 'CLAUDE.local.md', '- Use the local sandbox.\n');
    const nestedFile = writeFile(tmpDir, 'apps/api/CLAUDE.md', '- Run API tests before committing.\n');
    writeFile(tmpDir, 'apps/api/CLAUDE.local.md', '- Use the API sandbox.\n');

    const graph = loadEffectiveInstructionGraph(nestedFile, tmpDir);
    const texts = graph.rules.map((rule) => rule.text);

    expect(texts).toEqual([
      'Use pnpm for package management.',
      'Use the local sandbox.',
      'Run API tests before committing.',
      'Use the API sandbox.',
    ]);
    expect(graph.entryFiles).toEqual([
      join(tmpDir, 'CLAUDE.md'),
      join(tmpDir, 'CLAUDE.local.md'),
      join(tmpDir, 'apps/api/CLAUDE.md'),
      join(tmpDir, 'apps/api/CLAUDE.local.md'),
    ]);
  });

  it('stops the ancestor stack at the provided cwd boundary', () => {
    const parentDir = join(tmpDir, 'workspace');
    mkdirSync(parentDir, { recursive: true });

    writeFile(tmpDir, 'CLAUDE.md', '- Use the parent instructions for every project.\n');
    writeFile(parentDir, 'CLAUDE.md', '- Use the workspace instructions for this repo.\n');
    const nestedFile = writeFile(parentDir, 'apps/web/CLAUDE.md', '- Run web checks before shipping.\n');

    const graph = loadEffectiveInstructionGraph(nestedFile, parentDir);
    const texts = graph.rules.map((rule) => rule.text);

    expect(texts).toContain('Use the workspace instructions for this repo.');
    expect(texts).toContain('Run web checks before shipping.');
    expect(texts).not.toContain('Use the parent instructions for every project.');
  });
});
