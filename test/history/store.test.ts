import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ANALYSIS_VERSION } from '../../src/history/analysis-version.js';
import { HistoryStore } from '../../src/history/store.js';
import type { SessionResult } from '../../src/history/types.js';

function makeResult(sessionId: string, overrides?: Partial<SessionResult>): SessionResult {
  return {
    sessionId,
    timestamp: '2026-01-01T00:00:00Z',
    rulesVersion: 'abc123def456',
    analysisVersion: ANALYSIS_VERSION,
    observations: [
      {
        ruleId: 'rule-1',
        sessionId,
        relevant: true,
        followed: true,
        method: 'auto:bash-keyword',
        confidence: 'high',
      },
    ],
    ...overrides,
  };
}

describe('HistoryStore', () => {
  let tmpDir: string;
  let store: HistoryStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'alignkit-store-test-'));
    store = new HistoryStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('readAll', () => {
    it('returns empty array when file does not exist', () => {
      expect(store.readAll()).toEqual([]);
    });

    it('returns empty array when file is empty', () => {
      writeFileSync(join(tmpDir, 'history.jsonl'), '', 'utf-8');
      expect(store.readAll()).toEqual([]);
    });

    it('parses single JSONL entry', () => {
      const result = makeResult('sess-1');
      writeFileSync(join(tmpDir, 'history.jsonl'), JSON.stringify(result) + '\n', 'utf-8');

      const all = store.readAll();
      expect(all).toHaveLength(1);
      expect(all[0].sessionId).toBe('sess-1');
    });

    it('parses multiple JSONL entries', () => {
      const r1 = makeResult('sess-1');
      const r2 = makeResult('sess-2');
      const content = JSON.stringify(r1) + '\n' + JSON.stringify(r2) + '\n';
      writeFileSync(join(tmpDir, 'history.jsonl'), content, 'utf-8');

      const all = store.readAll();
      expect(all).toHaveLength(2);
      expect(all[0].sessionId).toBe('sess-1');
      expect(all[1].sessionId).toBe('sess-2');
    });
  });

  describe('append + readAll roundtrip', () => {
    it('appends and reads back a session result', () => {
      const result = makeResult('sess-roundtrip');
      store.append(result);

      const all = store.readAll();
      expect(all).toHaveLength(1);
      expect(all[0].sessionId).toBe('sess-roundtrip');
      expect(all[0].observations).toHaveLength(1);
      expect(all[0].observations[0].followed).toBe(true);
    });

    it('appends multiple results sequentially', () => {
      store.append(makeResult('sess-a'));
      store.append(makeResult('sess-b'));
      store.append(makeResult('sess-c'));

      const all = store.readAll();
      expect(all).toHaveLength(3);
      expect(all.map((r) => r.sessionId)).toEqual(['sess-a', 'sess-b', 'sess-c']);
    });
  });

  describe('hasSession / dedup', () => {
    it('returns false for non-existent session', () => {
      expect(store.hasSession('no-such-session')).toBe(false);
    });

    it('returns true for recorded session', () => {
      store.append(makeResult('sess-exists'));
      expect(store.hasSession('sess-exists')).toBe(true);
    });

    it('treats the same session as distinct across rules versions', () => {
      store.append(makeResult('sess-versioned', { rulesVersion: 'version-a' }));
      store.append(makeResult('sess-versioned', { rulesVersion: 'version-b' }));

      expect(store.hasSession('sess-versioned', 'version-a', ANALYSIS_VERSION)).toBe(true);
      expect(store.hasSession('sess-versioned', 'version-b', ANALYSIS_VERSION)).toBe(true);
      expect(store.readAll()).toHaveLength(2);
    });

    it('does not duplicate on re-append', () => {
      store.append(makeResult('sess-dup'));
      store.append(makeResult('sess-dup'));

      const all = store.readAll();
      expect(all).toHaveLength(1);
    });
  });

  describe('computeRulesVersion', () => {
    it('produces consistent hash for same content', () => {
      const filePath = join(tmpDir, 'rules.md');
      writeFileSync(filePath, '# Rules\n- Use pnpm\n', 'utf-8');

      const hash1 = HistoryStore.computeRulesVersion(filePath);
      const hash2 = HistoryStore.computeRulesVersion(filePath);

      expect(hash1).toBe(hash2);
    });

    it('returns 12-char hex string', () => {
      const filePath = join(tmpDir, 'rules.md');
      writeFileSync(filePath, 'content', 'utf-8');

      const hash = HistoryStore.computeRulesVersion(filePath);
      expect(hash).toMatch(/^[0-9a-f]{12}$/);
    });

    it('produces different hashes for different content', () => {
      const f1 = join(tmpDir, 'a.md');
      const f2 = join(tmpDir, 'b.md');
      writeFileSync(f1, 'content A', 'utf-8');
      writeFileSync(f2, 'content B', 'utf-8');

      expect(HistoryStore.computeRulesVersion(f1)).not.toBe(
        HistoryStore.computeRulesVersion(f2),
      );
    });

    it('changes when an imported file changes', () => {
      const rootFile = join(tmpDir, 'CLAUDE.md');
      const importedFile = join(tmpDir, 'docs.md');

      writeFileSync(rootFile, '- @docs.md\n', 'utf-8');
      writeFileSync(importedFile, '- Always use pnpm.\n', 'utf-8');

      const firstHash = HistoryStore.computeRulesVersion(rootFile);

      writeFileSync(importedFile, '- Always use bun.\n', 'utf-8');

      const secondHash = HistoryStore.computeRulesVersion(rootFile);
      expect(secondHash).not.toBe(firstHash);
    });

    it('changes when an ancestor memory file changes for a nested Claude target', () => {
      const rootFile = join(tmpDir, 'CLAUDE.md');
      const nestedDir = join(tmpDir, 'apps', 'api');
      const nestedFile = join(nestedDir, 'CLAUDE.md');

      mkdirSync(nestedDir, { recursive: true });
      writeFileSync(rootFile, '- Use pnpm.\n', 'utf-8');
      writeFileSync(nestedFile, '- Run API tests.\n', 'utf-8');

      const firstHash = HistoryStore.computeRulesVersion(nestedFile, tmpDir);

      writeFileSync(rootFile, '- Use bun.\n', 'utf-8');

      const secondHash = HistoryStore.computeRulesVersion(nestedFile, tmpDir);
      expect(secondHash).not.toBe(firstHash);
    });

    it('changes when a .claude/rules file changes for a Claude memory target', () => {
      const rootFile = join(tmpDir, 'CLAUDE.md');
      const rulesDir = join(tmpDir, '.claude', 'rules');
      const ruleFile = join(rulesDir, 'frontend.md');

      mkdirSync(rulesDir, { recursive: true });
      writeFileSync(rootFile, '- Use pnpm.\n', 'utf-8');
      writeFileSync(
        ruleFile,
        ['---', 'paths:', '  - "apps/web/**"', '---', '', '- Use React components.'].join('\n'),
        'utf-8',
      );

      const firstHash = HistoryStore.computeRulesVersion(rootFile, tmpDir);

      writeFileSync(
        ruleFile,
        ['---', 'paths:', '  - "apps/web/**"', '---', '', '- Use server components by default.'].join('\n'),
        'utf-8',
      );

      const secondHash = HistoryStore.computeRulesVersion(rootFile, tmpDir);
      expect(secondHash).not.toBe(firstHash);
    });
  });

  describe('queryByEpoch', () => {
    it('returns only sessions matching rulesVersion', () => {
      store.append(makeResult('sess-epoch-a', { rulesVersion: 'version-1' }));
      store.append(makeResult('sess-epoch-b', { rulesVersion: 'version-2' }));
      store.append(makeResult('sess-epoch-c', { rulesVersion: 'version-1' }));

      const v1Results = store.queryByEpoch('version-1');
      expect(v1Results).toHaveLength(2);
      expect(v1Results.map((r) => r.sessionId)).toEqual(['sess-epoch-a', 'sess-epoch-c']);
    });

    it('returns empty array for unknown epoch', () => {
      store.append(makeResult('sess-1'));
      expect(store.queryByEpoch('nonexistent')).toEqual([]);
    });

    it('filters by analysisVersion when provided', () => {
      store.append(makeResult('sess-current', { rulesVersion: 'version-1', analysisVersion: ANALYSIS_VERSION }));
      store.append(makeResult('sess-old', { rulesVersion: 'version-1', analysisVersion: '0.1.0' }));

      const currentResults = store.queryByEpoch('version-1', ANALYSIS_VERSION);
      expect(currentResults).toHaveLength(1);
      expect(currentResults[0].sessionId).toBe('sess-current');
    });
  });

  describe('lockfile cleanup', () => {
    it('does not leave lockfile after successful append', () => {
      store.append(makeResult('sess-lock'));
      expect(existsSync(join(tmpDir, 'history.lock'))).toBe(false);
    });

    it('creates .alignkit directory if it does not exist', () => {
      const nestedDir = join(tmpDir, 'sub', '.alignkit');
      const nestedStore = new HistoryStore(nestedDir);
      nestedStore.append(makeResult('sess-nested'));

      expect(existsSync(nestedDir)).toBe(true);
      expect(nestedStore.readAll()).toHaveLength(1);
    });
  });
});
