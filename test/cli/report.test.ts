import { describe, it, expect } from 'vitest';
import { computeReport, formatTerminalReport } from '../../src/cli/report.js';
import type { Rule } from '../../src/parsers/types.js';
import type { SessionResult } from '../../src/history/types.js';

function makeRule(id: string, text: string, section: string | null = null): Rule {
  return {
    id,
    slug: id,
    text,
    source: { file: 'CLAUDE.md', lineStart: 1, lineEnd: 1, section },
    category: 'behavioral',
    verifiability: 'auto',
    diagnostics: [],
  };
}

function makeSession(
  id: string,
  timestamp: string,
  observations: Array<{ ruleId: string; relevant: boolean; followed: boolean | null }>,
): SessionResult {
  return {
    sessionId: id,
    timestamp,
    rulesVersion: 'abc123',
    analysisVersion: '0.1.0',
    observations: observations.map((o) => ({
      ruleId: o.ruleId,
      sessionId: id,
      relevant: o.relevant,
      followed: o.followed,
      method: 'auto:bash-keyword',
      confidence: 'high',
    })),
  };
}

describe('computeReport', () => {
  const rules = [
    makeRule('r1', 'Run tests before committing'),
    makeRule('r2', 'Add JSDoc to public functions'),
    makeRule('r3', 'Use pnpm not npm'),
  ];

  it('returns zero sessions when no history is within window', () => {
    // Sessions from 30 days ago, window is 7 days
    const oldSession = makeSession('s1', new Date(Date.now() - 30 * 86400000).toISOString(), [
      { ruleId: 'r1', relevant: true, followed: true },
    ]);
    const data = computeReport(rules, [oldSession], 7);
    expect(data.totalSessions).toBe(0);
    expect(data.trends).toHaveLength(0);
  });

  it('prints no-history message when no sessions', () => {
    const data = computeReport(rules, [], 7);
    const output = formatTerminalReport(data);
    expect(output).toContain('No history found');
  });

  it('categorizes improved rules (>10% increase)', () => {
    const now = Date.now();
    // First half: 40% adherence for r1, second half: 80%
    const sessions = [
      // First half
      makeSession('s1', new Date(now - 6 * 86400000).toISOString(), [
        { ruleId: 'r1', relevant: true, followed: false },
        { ruleId: 'r1', relevant: true, followed: false },
        { ruleId: 'r1', relevant: true, followed: true },
      ]),
      makeSession('s2', new Date(now - 5 * 86400000).toISOString(), [
        { ruleId: 'r1', relevant: true, followed: false },
        { ruleId: 'r1', relevant: true, followed: true },
      ]),
      // Second half
      makeSession('s3', new Date(now - 2 * 86400000).toISOString(), [
        { ruleId: 'r1', relevant: true, followed: true },
        { ruleId: 'r1', relevant: true, followed: true },
      ]),
      makeSession('s4', new Date(now - 1 * 86400000).toISOString(), [
        { ruleId: 'r1', relevant: true, followed: true },
        { ruleId: 'r1', relevant: true, followed: true },
      ]),
    ];

    const data = computeReport(rules, sessions, 7);
    const r1Trend = data.trends.find((t) => t.rule.id === 'r1');
    expect(r1Trend).toBeDefined();
    expect(r1Trend!.category).toBe('IMPROVED');
  });

  it('categorizes degraded rules (>10% decrease)', () => {
    const now = Date.now();
    const sessions = [
      // First half: high adherence
      makeSession('s1', new Date(now - 6 * 86400000).toISOString(), [
        { ruleId: 'r2', relevant: true, followed: true },
      ]),
      makeSession('s2', new Date(now - 5 * 86400000).toISOString(), [
        { ruleId: 'r2', relevant: true, followed: true },
      ]),
      // Second half: low adherence
      makeSession('s3', new Date(now - 2 * 86400000).toISOString(), [
        { ruleId: 'r2', relevant: true, followed: false },
      ]),
      makeSession('s4', new Date(now - 1 * 86400000).toISOString(), [
        { ruleId: 'r2', relevant: true, followed: false },
      ]),
    ];

    const data = computeReport(rules, sessions, 7);
    const r2Trend = data.trends.find((t) => t.rule.id === 'r2');
    expect(r2Trend).toBeDefined();
    expect(r2Trend!.category).toBe('DEGRADED');
  });

  it('categorizes stable rules (within 10%)', () => {
    const now = Date.now();
    const sessions = [
      makeSession('s1', new Date(now - 6 * 86400000).toISOString(), [
        { ruleId: 'r3', relevant: true, followed: true },
      ]),
      makeSession('s2', new Date(now - 5 * 86400000).toISOString(), [
        { ruleId: 'r3', relevant: true, followed: true },
      ]),
      makeSession('s3', new Date(now - 2 * 86400000).toISOString(), [
        { ruleId: 'r3', relevant: true, followed: true },
      ]),
      makeSession('s4', new Date(now - 1 * 86400000).toISOString(), [
        { ruleId: 'r3', relevant: true, followed: true },
      ]),
    ];

    const data = computeReport(rules, sessions, 7);
    const r3Trend = data.trends.find((t) => t.rule.id === 'r3');
    expect(r3Trend).toBeDefined();
    expect(r3Trend!.category).toBe('STABLE');
  });

  it('generates recommendations for rules below 20%', () => {
    const now = Date.now();
    const sessions = [
      makeSession('s1', new Date(now - 3 * 86400000).toISOString(), [
        { ruleId: 'r1', relevant: true, followed: false },
        { ruleId: 'r2', relevant: true, followed: false },
      ]),
      makeSession('s2', new Date(now - 2 * 86400000).toISOString(), [
        { ruleId: 'r1', relevant: true, followed: false },
        { ruleId: 'r2', relevant: true, followed: false },
      ]),
      makeSession('s3', new Date(now - 1 * 86400000).toISOString(), [
        { ruleId: 'r1', relevant: true, followed: false },
        { ruleId: 'r2', relevant: true, followed: false },
      ]),
    ];

    const data = computeReport(rules, sessions, 7);
    // r1 and r2 both have 0% adherence — should be recommended
    const recs = data.recommendations.filter((r) => r.reason.includes('below 20%'));
    expect(recs.length).toBeGreaterThanOrEqual(2);
  });

  it('generates recommendation for never-relevant rules', () => {
    const now = Date.now();
    const sessions = [
      makeSession('s1', new Date(now - 2 * 86400000).toISOString(), [
        { ruleId: 'r1', relevant: true, followed: true },
        { ruleId: 'r2', relevant: false, followed: null },
        { ruleId: 'r3', relevant: false, followed: null },
      ]),
      makeSession('s2', new Date(now - 1 * 86400000).toISOString(), [
        { ruleId: 'r1', relevant: true, followed: true },
        { ruleId: 'r2', relevant: false, followed: null },
        { ruleId: 'r3', relevant: false, followed: null },
      ]),
    ];

    const data = computeReport(rules, sessions, 7);
    const neverRelevantRec = data.recommendations.find((r) =>
      r.reason.includes('never been relevant'),
    );
    expect(neverRelevantRec).toBeDefined();
  });

  it('filters sessions by --days window', () => {
    const now = Date.now();
    const sessions = [
      makeSession('s1', new Date(now - 10 * 86400000).toISOString(), [
        { ruleId: 'r1', relevant: true, followed: false },
      ]),
      makeSession('s2', new Date(now - 2 * 86400000).toISOString(), [
        { ruleId: 'r1', relevant: true, followed: true },
      ]),
    ];

    // 3-day window should only include s2
    const data = computeReport(rules, sessions, 3);
    expect(data.totalSessions).toBe(1);
  });
});

describe('formatTerminalReport', () => {
  it('includes section headers in output', () => {
    const now = Date.now();
    const rules = [makeRule('r1', 'Test rule')];
    const sessions = [
      makeSession('s1', new Date(now - 3 * 86400000).toISOString(), [
        { ruleId: 'r1', relevant: true, followed: true },
      ]),
      makeSession('s2', new Date(now - 1 * 86400000).toISOString(), [
        { ruleId: 'r1', relevant: true, followed: true },
      ]),
    ];

    const data = computeReport(rules, sessions, 7);
    const output = formatTerminalReport(data);
    expect(output).toContain('ADHERENCE REPORT');
    expect(output).toContain('Overall:');
  });
});
