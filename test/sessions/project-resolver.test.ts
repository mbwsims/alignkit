import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { encodeProjectPath, resolveProjectDir } from '../../src/sessions/project-resolver.js';

describe('encodeProjectPath', () => {
  it('replaces all slashes with hyphens', () => {
    expect(encodeProjectPath('/Users/you/projects/my-app')).toBe(
      '-Users-you-projects-my-app',
    );
  });

  it('handles root path', () => {
    expect(encodeProjectPath('/')).toBe('-');
  });

  it('handles single-level path', () => {
    expect(encodeProjectPath('/foo')).toBe('-foo');
  });
});

describe('resolveProjectDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'alignkit-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when claudeDir does not exist', () => {
    const result = resolveProjectDir('/some/path', join(tmpDir, 'nonexistent'));
    expect(result).toBeNull();
  });

  it('finds project via direct path encoding match', () => {
    const cwd = '/Users/you/projects/my-app';
    const encoded = '-Users-you-projects-my-app';
    const projectDir = join(tmpDir, encoded);
    mkdirSync(projectDir, { recursive: true });

    const result = resolveProjectDir(cwd, tmpDir);
    expect(result).toBe(projectDir);
  });

  it('falls back to sessions-index.json scan when encoding does not match', () => {
    const cwd = '/Users/you/other-project';
    // Create a directory with a different name (not the encoded form)
    const dirName = 'some-other-dir-name';
    const projectDir = join(tmpDir, dirName);
    mkdirSync(projectDir, { recursive: true });

    // Write a sessions-index.json that references cwd
    const indexData = {
      version: 1,
      entries: [
        {
          sessionId: 'sess-001',
          fullPath: join(projectDir, 'sess-001.jsonl'),
          projectPath: cwd,
          modified: '2026-03-27T10:00:00.000Z',
        },
      ],
    };
    writeFileSync(join(projectDir, 'sessions-index.json'), JSON.stringify(indexData));

    const result = resolveProjectDir(cwd, tmpDir);
    expect(result).toBe(projectDir);
  });

  it('returns null when no directory matches CWD', () => {
    const cwd = '/Users/you/unknown-project';
    // Create a directory with an index that does NOT match
    const dirName = 'other-project';
    const projectDir = join(tmpDir, dirName);
    mkdirSync(projectDir, { recursive: true });

    const indexData = {
      version: 1,
      entries: [
        {
          sessionId: 'sess-002',
          fullPath: join(projectDir, 'sess-002.jsonl'),
          projectPath: '/Users/you/different-project',
          modified: '2026-03-27T10:00:00.000Z',
        },
      ],
    };
    writeFileSync(join(projectDir, 'sessions-index.json'), JSON.stringify(indexData));

    const result = resolveProjectDir(cwd, tmpDir);
    expect(result).toBeNull();
  });

  it('skips malformed sessions-index.json files', () => {
    const dirName = 'bad-index';
    const projectDir = join(tmpDir, dirName);
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'sessions-index.json'), 'NOT VALID JSON');

    const result = resolveProjectDir('/some/path', tmpDir);
    expect(result).toBeNull();
  });
});
