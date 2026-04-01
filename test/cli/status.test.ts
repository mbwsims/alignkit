import { describe, it, expect } from 'vitest';
import {
  sparkline,
  sessionAdherence,
  computeTrend,
  computeStatus,
} from '../../src/cli/status.js';
import { ANALYSIS_VERSION } from '../../src/history/analysis-version.js';
import type { SessionResult } from '../../src/history/types.js';

function makeSession(
  id: string,
  timestamp: string,
  observations: Array<{ ruleId: string; relevant: boolean; followed: boolean | null }>,
): SessionResult {
  return {
    sessionId: id,
    timestamp,
    rulesVersion: 'abc123',
    analysisVersion: ANALYSIS_VERSION,
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

describe('sparkline', () => {
  it('returns empty string for empty array', () => {
    expect(sparkline([])).toBe('');
  });

  it('generates sparkline for uniform values', () => {
    const result = sparkline([1, 1, 1]);
    expect(result).toBe('\u2588\u2588\u2588');
  });

  it('generates sparkline for ascending values', () => {
    const result = sparkline([0, 0.25, 0.5, 0.75, 1]);
    expect(result.length).toBe(5);
    // First char should be lowest, last should be highest
    expect(result[0]).toBe('\u2581');
    expect(result[4]).toBe('\u2588');
  });

  it('generates sparkline for varying values', () => {
    const result = sparkline([0.2, 0.4, 0.6, 0.8, 1.0]);
    expect(result.length).toBe(5);
  });
});

describe('sessionAdherence', () => {
  it('returns 1 when no observations are relevant', () => {
    const session = makeSession('s1', '2025-01-01T00:00:00Z', [
      { ruleId: 'r1', relevant: false, followed: null },
    ]);
    expect(sessionAdherence(session)).toBe(1);
  });

  it('computes adherence correctly', () => {
    const session = makeSession('s1', '2025-01-01T00:00:00Z', [
      { ruleId: 'r1', relevant: true, followed: true },
      { ruleId: 'r2', relevant: true, followed: false },
      { ruleId: 'r3', relevant: true, followed: true },
      { ruleId: 'r4', relevant: false, followed: null },
    ]);
    expect(sessionAdherence(session)).toBeCloseTo(2 / 3);
  });

  it('returns 1 when all relevant rules are followed', () => {
    const session = makeSession('s1', '2025-01-01T00:00:00Z', [
      { ruleId: 'r1', relevant: true, followed: true },
      { ruleId: 'r2', relevant: true, followed: true },
    ]);
    expect(sessionAdherence(session)).toBe(1);
  });
});

describe('computeTrend', () => {
  it('returns stable for single value', () => {
    expect(computeTrend([0.5])).toBe('stable');
  });

  it('returns trending up when second half is higher', () => {
    expect(computeTrend([0.3, 0.3, 0.9, 0.9])).toBe('trending up');
  });

  it('returns trending down when second half is lower', () => {
    expect(computeTrend([0.9, 0.9, 0.3, 0.3])).toBe('trending down');
  });

  it('returns stable when halves are similar', () => {
    expect(computeTrend([0.5, 0.5, 0.5, 0.5])).toBe('stable');
  });
});

describe('computeStatus', () => {
  it('returns no-history message when sessions are empty', () => {
    const output = computeStatus('CLAUDE.md', []);
    expect(output).toContain('No history found');
    expect(output).toContain('alignkit watch');
    expect(output).toContain('alignkit check');
  });

  it('computes status output with mock history data', () => {
    const sessions: SessionResult[] = [];

    // Create 5 sessions over 5 days
    for (let i = 0; i < 5; i++) {
      const date = new Date(2025, 0, 10 + i);
      sessions.push(
        makeSession(`session-${i}`, date.toISOString(), [
          { ruleId: 'r1', relevant: true, followed: true },
          { ruleId: 'r2', relevant: true, followed: i > 2 },  // followed in last 2
          { ruleId: 'r3', relevant: true, followed: false },   // never followed
          { ruleId: 'r4', relevant: false, followed: null },
        ]),
      );
    }

    const output = computeStatus('CLAUDE.md', sessions);

    // Should contain file name
    expect(output).toContain('CLAUDE.md');

    // Should contain adherence percentage
    expect(output).toMatch(/\d+% adherence/);

    // Should contain session count
    expect(output).toContain('5 sessions');

    // Should contain sparkline characters
    expect(output).toMatch(/[\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588]/);

    // Should contain trend
    expect(output).toMatch(/trending (up|down)|stable/);

    // Should contain rule stats
    expect(output).toMatch(/\d+ rules tracked/);
    expect(output).toMatch(/\d+ fully followed/);
    expect(output).toMatch(/\d+ consistently violated/);
    expect(output).toMatch(/\d+ new/);
  });

  it('calculates correct overall adherence', () => {
    const sessions = [
      makeSession('s1', '2025-01-10T00:00:00Z', [
        { ruleId: 'r1', relevant: true, followed: true },
        { ruleId: 'r2', relevant: true, followed: true },
      ]),
      makeSession('s2', '2025-01-11T00:00:00Z', [
        { ruleId: 'r1', relevant: true, followed: true },
        { ruleId: 'r2', relevant: true, followed: false },
      ]),
    ];

    const output = computeStatus('CLAUDE.md', sessions);
    // 3 followed out of 4 relevant = 75%
    expect(output).toContain('75% adherence');
  });

  it('handles single session correctly', () => {
    const sessions = [
      makeSession('s1', '2025-01-10T00:00:00Z', [
        { ruleId: 'r1', relevant: true, followed: true },
      ]),
    ];

    const output = computeStatus('CLAUDE.md', sessions);
    expect(output).toContain('100% adherence');
    expect(output).toContain('1 sessions');
  });
});
