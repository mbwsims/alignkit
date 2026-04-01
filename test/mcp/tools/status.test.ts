import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ANALYSIS_VERSION } from '../../../src/history/analysis-version.js';
import { HistoryStore } from '../../../src/history/store.js';
import { statusTool } from '../../../src/mcp/tools/status.js';
import type { SessionResult } from '../../../src/history/types.js';

describe('statusTool', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `alignkit-status-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty state when no history exists', () => {
    writeFileSync(
      join(tmpDir, 'CLAUDE.md'),
      '- Always use pnpm\n',
    );

    const result = statusTool(tmpDir);

    expect(result.file).toBe('CLAUDE.md');
    expect(result.adherence).toBe(0);
    expect(result.sessionCount).toBe(0);
    expect(result.trend).toBe('insufficient');
    expect(result.rules).toEqual({ total: 0, fullyFollowed: 0, violated: 0, new: 0 });
  });

  it('returns empty state when no instruction files found', () => {
    const result = statusTool(tmpDir);

    expect(result.file).toBe('(none)');
    expect(result.adherence).toBe(0);
    expect(result.sessionCount).toBe(0);
    expect(result.trend).toBe('insufficient');
  });

  it('computes adherence from mock history', () => {
    const claudeFile = join(tmpDir, 'CLAUDE.md');
    writeFileSync(claudeFile, '- Always use pnpm\n');

    // Create .alignkit/history.jsonl with mock session data
    const alignkitDir = join(tmpDir, '.alignkit');
    mkdirSync(alignkitDir, { recursive: true });

    const rulesVersion = HistoryStore.computeRulesVersion(claudeFile);

    const session1: SessionResult = {
      sessionId: 'sess-1',
      timestamp: new Date(Date.now() - 86400000).toISOString(),
      rulesVersion,
      analysisVersion: ANALYSIS_VERSION,
      observations: [
        {
          ruleId: 'rule-1',
          sessionId: 'sess-1',
          relevant: true,
          followed: true,
          method: 'auto:bash-keyword',
          confidence: 'high',
        },
      ],
    };

    const session2: SessionResult = {
      sessionId: 'sess-2',
      timestamp: new Date(Date.now() - 43200000).toISOString(),
      rulesVersion,
      analysisVersion: ANALYSIS_VERSION,
      observations: [
        {
          ruleId: 'rule-1',
          sessionId: 'sess-2',
          relevant: true,
          followed: false,
          method: 'auto:bash-keyword',
          confidence: 'high',
        },
      ],
    };

    const historyPath = join(alignkitDir, 'history.jsonl');
    writeFileSync(historyPath, JSON.stringify(session1) + '\n');
    appendFileSync(historyPath, JSON.stringify(session2) + '\n');

    const result = statusTool(tmpDir);

    expect(result.file).toBe('CLAUDE.md');
    expect(result.sessionCount).toBe(2);
    expect(result.adherence).toBe(50); // 1 followed out of 2 relevant
    expect(result.rules.total).toBe(1);
  });

  it('computes trend from sufficient session data', () => {
    const claudeFile = join(tmpDir, 'CLAUDE.md');
    writeFileSync(claudeFile, '- Always use pnpm\n');

    const alignkitDir = join(tmpDir, '.alignkit');
    mkdirSync(alignkitDir, { recursive: true });

    const rulesVersion = HistoryStore.computeRulesVersion(claudeFile);
    const historyPath = join(alignkitDir, 'history.jsonl');

    // Create 4 sessions: first 2 have 0% adherence, last 2 have 100%
    for (let i = 0; i < 4; i++) {
      const session: SessionResult = {
        sessionId: `sess-${i}`,
        timestamp: new Date(Date.now() - (4 - i) * 3600000).toISOString(),
        rulesVersion,
        analysisVersion: ANALYSIS_VERSION,
        observations: [
          {
            ruleId: 'rule-1',
            sessionId: `sess-${i}`,
            relevant: true,
            followed: i >= 2, // first 2 not followed, last 2 followed
            method: 'auto:bash-keyword',
            confidence: 'high',
          },
        ],
      };
      appendFileSync(historyPath, JSON.stringify(session) + '\n');
    }

    const result = statusTool(tmpDir);

    expect(result.sessionCount).toBe(4);
    expect(result.trend).toBe('up');
  });

  it('uses explicit file path when provided', () => {
    const subDir = join(tmpDir, 'sub');
    mkdirSync(subDir, { recursive: true });
    writeFileSync(
      join(subDir, 'CLAUDE.md'),
      '- Use ESM imports\n',
    );

    const result = statusTool(tmpDir, join('sub', 'CLAUDE.md'));

    expect(result.file).toBe(join('sub', 'CLAUDE.md'));
  });

  it('uses stacked memory hash when a local Claude file is present', () => {
    const claudeFile = join(tmpDir, 'CLAUDE.md');
    writeFileSync(claudeFile, '- Always use pnpm\n');
    writeFileSync(join(tmpDir, 'CLAUDE.local.md'), '- Use the local sandbox\n');

    const alignkitDir = join(tmpDir, '.alignkit');
    mkdirSync(alignkitDir, { recursive: true });

    const rulesVersion = HistoryStore.computeRulesVersion(claudeFile, tmpDir);

    const session: SessionResult = {
      sessionId: 'sess-stacked',
      timestamp: new Date().toISOString(),
      rulesVersion,
      analysisVersion: ANALYSIS_VERSION,
      observations: [
        {
          ruleId: 'rule-1',
          sessionId: 'sess-stacked',
          relevant: true,
          followed: true,
          method: 'auto:bash-keyword',
          confidence: 'high',
        },
      ],
    };

    writeFileSync(join(alignkitDir, 'history.jsonl'), JSON.stringify(session) + '\n');

    const result = statusTool(tmpDir);
    expect(result.sessionCount).toBe(1);
  });
});
