import { describe, it, expect } from 'vitest';
import { flagRules } from '../../src/optimizer/flagger.js';
import type { Rule } from '../../src/parsers/types.js';

function makeRule(id: string, text: string): Rule {
  return {
    id,
    slug: id,
    text,
    source: { file: 'CLAUDE.md', lineStart: 1, lineEnd: 1, section: null },
    category: 'behavioral',
    verifiability: 'auto',
    diagnostics: [],
  };
}

describe('flagRules', () => {
  it('flags rules with low adherence', () => {
    const rules = [
      makeRule('r1', 'Rule with 10% adherence'),
      makeRule('r2', 'Rule with 90% adherence'),
    ];

    const adherenceMap = new Map<string, number>();
    adherenceMap.set('r1', 10);
    adherenceMap.set('r2', 90);

    const relevanceMap = new Map<string, number>();
    relevanceMap.set('r1', 5);
    relevanceMap.set('r2', 5);

    const result = flagRules(rules, adherenceMap, relevanceMap);
    expect(result).toHaveLength(1);
    expect(result[0].rule.id).toBe('r1');
    expect(result[0].reason).toBe('low-adherence');
    expect(result[0].adherence).toBe(10);
  });

  it('flags never-relevant rules', () => {
    const rules = [
      makeRule('r1', 'Relevant rule'),
      makeRule('r2', 'Never relevant rule'),
    ];

    const adherenceMap = new Map<string, number>();
    adherenceMap.set('r1', 80);
    adherenceMap.set('r2', 0);

    const relevanceMap = new Map<string, number>();
    relevanceMap.set('r1', 10);
    relevanceMap.set('r2', 0);

    const result = flagRules(rules, adherenceMap, relevanceMap);
    expect(result).toHaveLength(1);
    expect(result[0].rule.id).toBe('r2');
    expect(result[0].reason).toBe('never-relevant');
  });

  it('respects custom threshold', () => {
    const rules = [makeRule('r1', 'Rule at 30%')];

    const adherenceMap = new Map<string, number>();
    adherenceMap.set('r1', 30);

    const relevanceMap = new Map<string, number>();
    relevanceMap.set('r1', 5);

    // Default threshold is 20, so 30% should pass
    const defaultResult = flagRules(rules, adherenceMap, relevanceMap);
    expect(defaultResult).toHaveLength(0);

    // Custom threshold of 50 should flag it
    const customResult = flagRules(rules, adherenceMap, relevanceMap, 50);
    expect(customResult).toHaveLength(1);
    expect(customResult[0].reason).toBe('low-adherence');
  });

  it('returns empty array when no rules need flagging', () => {
    const rules = [makeRule('r1', 'Good rule')];

    const adherenceMap = new Map<string, number>();
    adherenceMap.set('r1', 80);

    const relevanceMap = new Map<string, number>();
    relevanceMap.set('r1', 10);

    const result = flagRules(rules, adherenceMap, relevanceMap);
    expect(result).toHaveLength(0);
  });

  it('prioritizes never-relevant over low-adherence', () => {
    // If a rule is never relevant, it should be flagged as never-relevant
    // even though its adherence is 0 (which is below threshold)
    const rules = [makeRule('r1', 'Never seen rule')];

    const adherenceMap = new Map<string, number>();
    adherenceMap.set('r1', 0);

    const relevanceMap = new Map<string, number>();
    relevanceMap.set('r1', 0);

    const result = flagRules(rules, adherenceMap, relevanceMap);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('never-relevant');
  });
});
