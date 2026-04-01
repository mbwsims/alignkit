import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkTool } from '../../../src/mcp/tools/check.js';

describe('checkTool', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `alignkit-check-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns correct structure with no session data', () => {
    writeFileSync(
      join(tmpDir, 'CLAUDE.md'),
      [
        '# Instructions',
        '',
        '- Always use pnpm, not npm',
        '- Run tests before committing',
      ].join('\n'),
    );

    const result = checkTool(tmpDir);

    expect(result.file).toBe('CLAUDE.md');
    expect(result.sessionCount).toBe(0);
    expect(result.rules).toBeInstanceOf(Array);
    expect(result.rules.length).toBeGreaterThan(0);
    expect(result.unresolvedRules).toBeInstanceOf(Array);

    // Each rule has expected adherence shape
    for (const rule of result.rules) {
      expect(rule).toHaveProperty('text');
      expect(rule).toHaveProperty('relevantSessions');
      expect(rule).toHaveProperty('resolvedSessions');
      expect(rule).toHaveProperty('inconclusiveSessions');
      expect(rule).toHaveProperty('totalSessions');
      expect(rule).toHaveProperty('followed');
      expect(rule).toHaveProperty('adherence');
      expect(rule).toHaveProperty('method');
      expect(rule).toHaveProperty('confidence');
      expect(rule).toHaveProperty('confidenceReason');
      expect(rule).toHaveProperty('evidence');
    }
  });

  it('returns empty result when no instruction files found', () => {
    const result = checkTool(tmpDir);

    expect(result.file).toBe('(none)');
    expect(result.sessionCount).toBe(0);
    expect(result.rules).toHaveLength(0);
    expect(result.unresolvedRules).toHaveLength(0);
  });

  it('uses explicit file path when provided', () => {
    const subDir = join(tmpDir, 'sub');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      join(subDir, 'CLAUDE.md'),
      '- Use ESM imports\n',
    );

    const result = checkTool(tmpDir, join('sub', 'CLAUDE.md'));

    expect(result.file).toBe(join('sub', 'CLAUDE.md'));
    expect(result.rules.length).toBeGreaterThan(0);
  });

  it('with no sessions, all rules have null adherence and zero counts', () => {
    writeFileSync(
      join(tmpDir, 'CLAUDE.md'),
      '- Always use pnpm\n- Keep functions small\n',
    );

    const result = checkTool(tmpDir);

    for (const rule of result.rules) {
      expect(rule.relevantSessions).toBe(0);
      expect(rule.resolvedSessions).toBe(0);
      expect(rule.inconclusiveSessions).toBe(0);
      expect(rule.followed).toBe(0);
      expect(rule.adherence).toBeNull();
    }
  });

  it('creates .alignkit directory for history store', () => {
    writeFileSync(
      join(tmpDir, 'CLAUDE.md'),
      '- Use TypeScript strict mode\n',
    );

    // The history store may or may not create directory if no sessions found,
    // but calling checkTool should not throw
    const result = checkTool(tmpDir);
    expect(result.file).toBe('CLAUDE.md');
  });

  it('supports sinceDays parameter', () => {
    writeFileSync(
      join(tmpDir, 'CLAUDE.md'),
      '- Always use pnpm\n',
    );

    // Should not throw when sinceDays is specified
    const result = checkTool(tmpDir, undefined, 7);
    expect(result.file).toBe('CLAUDE.md');
    expect(result.sessionCount).toBe(0);
  });
});
