import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  discoverInstructionFiles,
  discoverInstructionTargets,
  parseInstructionFile,
} from '../../src/parsers/auto-detect.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `alignkit-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFile(dir: string, relPath: string, content: string): void {
  const abs = join(dir, relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

const CLAUDE_MD_CONTENT = `# Rules\n\n- Always use TypeScript strict mode.\n- Use pnpm for package management.\n`;
const CURSORRULES_CONTENT = `Always use TypeScript strict mode.\nPrefer functional components in React.\nUse pnpm for package management.\n`;
const AGENTS_MD_CONTENT = `# Agent Rules\n\n- Never commit secrets.\n- Always run tests before merging.\n`;
const CURSOR_MDC_CONTENT = `---
description: TypeScript rule
globs:
  - "**/*.ts"
---

- Use TypeScript strict mode.
- Never use \`any\`.
`;

describe('discoverInstructionFiles', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('finds CLAUDE.md at root', () => {
    writeFile(tmpDir, 'CLAUDE.md', CLAUDE_MD_CONTENT);
    const files = discoverInstructionFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('CLAUDE.md');
    expect(files[0].isRoot).toBe(true);
  });

  it('finds nested CLAUDE.md files in subdirectories', () => {
    writeFile(tmpDir, 'CLAUDE.md', CLAUDE_MD_CONTENT);
    writeFile(tmpDir, 'src/api/CLAUDE.md', CLAUDE_MD_CONTENT);
    const files = discoverInstructionFiles(tmpDir);
    const paths = files.map((f) => f.relativePath);
    expect(paths).toContain('CLAUDE.md');
    expect(paths).toContain('src/api/CLAUDE.md');
    const nested = files.find((f) => f.relativePath === 'src/api/CLAUDE.md');
    expect(nested?.isRoot).toBe(false);
  });

  it('finds .cursorrules', () => {
    writeFile(tmpDir, '.cursorrules', CURSORRULES_CONTENT);
    const files = discoverInstructionFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('.cursorrules');
    expect(files[0].isRoot).toBe(true);
  });

  it('finds CLAUDE.local.md at root', () => {
    writeFile(tmpDir, 'CLAUDE.local.md', CLAUDE_MD_CONTENT);
    const files = discoverInstructionFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('CLAUDE.local.md');
    expect(files[0].isRoot).toBe(true);
  });

  it('finds .cursor/rules in a subdirectory', () => {
    writeFile(tmpDir, 'subdir/.cursor/rules', CURSORRULES_CONTENT);
    const files = discoverInstructionFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('subdir/.cursor/rules');
    expect(files[0].isRoot).toBe(false);
  });

  it('finds .cursor/rules/*.mdc files', () => {
    writeFile(tmpDir, '.cursor/rules/typescript.mdc', CURSOR_MDC_CONTENT);
    const files = discoverInstructionFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0].relativePath).toBe('.cursor/rules/typescript.mdc');
  });

  it('returns primary file first by priority when both CLAUDE.md and .cursorrules exist', () => {
    writeFile(tmpDir, 'CLAUDE.md', CLAUDE_MD_CONTENT);
    writeFile(tmpDir, '.cursorrules', CURSORRULES_CONTENT);
    const files = discoverInstructionFiles(tmpDir);
    expect(files[0].relativePath).toBe('CLAUDE.md');
    const paths = files.map((f) => f.relativePath);
    expect(paths).toContain('.cursorrules');
  });

  it('returns ALL found files', () => {
    writeFile(tmpDir, 'CLAUDE.md', CLAUDE_MD_CONTENT);
    writeFile(tmpDir, 'src/api/CLAUDE.md', CLAUDE_MD_CONTENT);
    writeFile(tmpDir, 'AGENTS.md', AGENTS_MD_CONTENT);
    const files = discoverInstructionFiles(tmpDir);
    expect(files).toHaveLength(3);
    const paths = files.map((f) => f.relativePath);
    expect(paths).toContain('CLAUDE.md');
    expect(paths).toContain('src/api/CLAUDE.md');
    expect(paths).toContain('AGENTS.md');
  });

  it('returns empty array when no files found', () => {
    const files = discoverInstructionFiles(tmpDir);
    expect(files).toHaveLength(0);
  });
});

describe('discoverInstructionTargets', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('collapses same-directory Claude memory files into a single target', () => {
    writeFile(tmpDir, 'CLAUDE.md', CLAUDE_MD_CONTENT);
    writeFile(tmpDir, 'CLAUDE.local.md', CLAUDE_MD_CONTENT);
    writeFile(tmpDir, 'apps/api/CLAUDE.md', CLAUDE_MD_CONTENT);
    writeFile(tmpDir, 'apps/api/CLAUDE.local.md', CLAUDE_MD_CONTENT);
    writeFile(tmpDir, 'AGENTS.md', AGENTS_MD_CONTENT);

    const targets = discoverInstructionTargets(tmpDir).map((file) => file.relativePath);

    expect(targets).toEqual([
      'CLAUDE.md',
      'AGENTS.md',
      'apps/api/CLAUDE.md',
    ]);
  });
});

describe('parseInstructionFile', () => {
  it('parses CLAUDE.md content and returns rules', () => {
    const rules = parseInstructionFile(CLAUDE_MD_CONTENT, '/project/CLAUDE.md');
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r) => r.source.file === '/project/CLAUDE.md')).toBe(true);
  });

  it('parses CLAUDE.local.md content and returns rules', () => {
    const rules = parseInstructionFile(CLAUDE_MD_CONTENT, '/project/CLAUDE.local.md');
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r) => r.source.file === '/project/CLAUDE.local.md')).toBe(true);
  });

  it('parses .cursorrules content and returns rules', () => {
    const rules = parseInstructionFile(CURSORRULES_CONTENT, '/project/.cursorrules');
    expect(rules).toHaveLength(3);
    expect(rules.every((r) => r.source.file === '/project/.cursorrules')).toBe(true);
  });

  it('parses .cursor/rules/*.mdc content and ignores frontmatter', () => {
    const rules = parseInstructionFile(CURSOR_MDC_CONTENT, '/project/.cursor/rules/typescript.mdc');
    const texts = rules.map((r) => r.text);
    expect(texts).toContain('Use TypeScript strict mode.');
    expect(texts).toContain('Never use `any`.');
    expect(texts.some((text) => text.includes('description:'))).toBe(false);
  });

  it('parses AGENTS.md content and returns rules', () => {
    const rules = parseInstructionFile(AGENTS_MD_CONTENT, '/project/AGENTS.md');
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((r) => r.source.file === '/project/AGENTS.md')).toBe(true);
  });

  it('falls back to parseClaudeMd for unknown filenames', () => {
    const content = `# Rules\n\n- Always use strict mode.\n`;
    const rules = parseInstructionFile(content, '/project/CUSTOM.md');
    expect(rules.length).toBeGreaterThan(0);
  });
});
