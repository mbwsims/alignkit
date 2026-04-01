import { describe, expect, it } from 'vitest';
import { aggregateAdherence } from '../../src/check/adherence.js';
import type { SessionResult } from '../../src/history/types.js';
import type { Rule } from '../../src/parsers/types.js';

function makeRule(text: string, id = 'rule-1'): Rule {
  return {
    id,
    slug: id,
    text,
    source: {
      file: 'CLAUDE.md',
      lineStart: 1,
      lineEnd: 1,
      section: null,
    },
    category: 'behavioral',
    verifiability: 'auto',
    diagnostics: [],
  };
}

function makeResult(
  sessionId: string,
  ruleId: string,
  observation: SessionResult['observations'][number],
): SessionResult {
  return {
    sessionId,
    timestamp: '2026-01-01T00:00:00Z',
    rulesVersion: 'version-1',
    analysisVersion: 'analysis-1',
    observations: [{ ...observation, ruleId, sessionId }],
  };
}

describe('aggregateAdherence', () => {
  it('does not count inconclusive relevant sessions as failures', () => {
    const rule = makeRule('Use TypeScript strict mode', 'rule-ts');
    const results: SessionResult[] = [
      makeResult('sess-1', rule.id, {
        ruleId: rule.id,
        sessionId: 'sess-1',
        relevant: true,
        followed: null,
        method: 'llm-judge',
        confidence: 'medium',
        evidence: 'Edited tsconfig.json, but strictness could not be determined.',
      }),
      makeResult('sess-2', rule.id, {
        ruleId: rule.id,
        sessionId: 'sess-2',
        relevant: true,
        followed: true,
        method: 'llm-judge',
        confidence: 'medium',
        evidence: 'Enabled strict mode in tsconfig.json.',
      }),
    ];

    const [adherence] = aggregateAdherence([rule], results);

    expect(adherence.relevantCount).toBe(2);
    expect(adherence.resolvedCount).toBe(1);
    expect(adherence.inconclusiveCount).toBe(1);
    expect(adherence.followedCount).toBe(1);
    expect(adherence.adherence).toBe(1);
  });

  it('downgrades confidence for a single resolved session', () => {
    const rule = makeRule('Use pnpm, not npm', 'rule-pnpm');
    const results: SessionResult[] = [
      makeResult('sess-1', rule.id, {
        ruleId: rule.id,
        sessionId: 'sess-1',
        relevant: true,
        followed: true,
        method: 'auto:bash-keyword',
        confidence: 'high',
        evidence: 'preferred: pnpm install',
      }),
    ];

    const [adherence] = aggregateAdherence([rule], results);

    expect(adherence.confidence).toBe('medium');
    expect(adherence.confidenceReason).toContain('1 resolved session');
  });

  it('promotes confidence for consistent high-signal evidence across many sessions', () => {
    const rule = makeRule('Use pnpm, not npm', 'rule-pnpm');
    const results = Array.from({ length: 5 }, (_, index) =>
      makeResult(`sess-${index + 1}`, rule.id, {
        ruleId: rule.id,
        sessionId: `sess-${index + 1}`,
        relevant: true,
        followed: true,
        method: 'auto:bash-keyword',
        confidence: 'high',
        evidence: `preferred: pnpm install #${index + 1}`,
      }));

    const [adherence] = aggregateAdherence([rule], results);

    expect(adherence.confidence).toBe('high');
    expect(adherence.adherence).toBe(1);
  });

  it('uses the dominant resolved method instead of the single strongest observation', () => {
    const rule = makeRule('Use TypeScript strict mode', 'rule-ts');
    const results: SessionResult[] = [
      makeResult('sess-1', rule.id, {
        ruleId: rule.id,
        sessionId: 'sess-1',
        relevant: true,
        followed: true,
        method: 'auto:heuristic-structure',
        confidence: 'medium',
        evidence: 'tsconfig.json has strict: true',
      }),
      makeResult('sess-2', rule.id, {
        ruleId: rule.id,
        sessionId: 'sess-2',
        relevant: true,
        followed: true,
        method: 'llm-judge',
        confidence: 'medium',
        evidence: 'Edited tsconfig.json with strict enabled.',
      }),
      makeResult('sess-3', rule.id, {
        ruleId: rule.id,
        sessionId: 'sess-3',
        relevant: true,
        followed: true,
        method: 'llm-judge',
        confidence: 'medium',
        evidence: 'Created strict tsconfig in app workspace.',
      }),
    ];

    const [adherence] = aggregateAdherence([rule], results);

    expect(adherence.method).toBe('llm-judge');
  });

  it('reports scope-filtered rules as not exercised with scoped evidence', () => {
    const rule = makeRule('For apps/web/**, use React Server Components', 'rule-scope');
    const results: SessionResult[] = [
      makeResult('sess-1', rule.id, {
        ruleId: rule.id,
        sessionId: 'sess-1',
        relevant: false,
        followed: null,
        method: 'scope:filtered',
        confidence: 'high',
        evidence: 'No touched files matched this rule\'s scope (apps/web/**).',
      }),
      makeResult('sess-2', rule.id, {
        ruleId: rule.id,
        sessionId: 'sess-2',
        relevant: false,
        followed: null,
        method: 'scope:filtered',
        confidence: 'high',
        evidence: 'No touched files matched this rule\'s scope (apps/web/**).',
      }),
    ];

    const [adherence] = aggregateAdherence([rule], results);

    expect(adherence.relevantCount).toBe(0);
    expect(adherence.method).toBe('scope:filtered');
    expect(adherence.confidence).toBe('medium');
    expect(adherence.evidence).toContain('apps/web/**');
  });
});
