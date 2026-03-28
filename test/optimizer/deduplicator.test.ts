import { describe, it, expect } from 'vitest';
import { deduplicateRules, jaccardSimilarity } from '../../src/optimizer/deduplicator.js';
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

describe('jaccardSimilarity', () => {
  it('returns 1 for identical sets', () => {
    const a = new Set(['foo', 'bar']);
    expect(jaccardSimilarity(a, a)).toBe(1);
  });

  it('returns 0 for disjoint sets', () => {
    const a = new Set(['foo', 'bar']);
    const b = new Set(['baz', 'qux']);
    expect(jaccardSimilarity(a, b)).toBe(0);
  });

  it('returns 1 for two empty sets', () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(1);
  });
});

describe('deduplicateRules', () => {
  it('merges near-duplicate rules and keeps higher adherence', () => {
    const rules = [
      makeRule('r1', 'Always run tests before committing code changes'),
      makeRule('r2', 'Run tests before committing any code changes'),
    ];

    const adherenceMap = new Map<string, number>();
    adherenceMap.set('r1', 90);
    adherenceMap.set('r2', 60);

    const result = deduplicateRules(rules, adherenceMap);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].id).toBe('r1');
    expect(result.deduped).toHaveLength(1);
    expect(result.deduped[0].kept.id).toBe('r1');
    expect(result.deduped[0].removed.id).toBe('r2');
  });

  it('keeps rule with higher adherence when second is better', () => {
    const rules = [
      makeRule('r1', 'Always run tests before committing code changes'),
      makeRule('r2', 'Run tests before committing any code changes'),
    ];

    const adherenceMap = new Map<string, number>();
    adherenceMap.set('r1', 30);
    adherenceMap.set('r2', 80);

    const result = deduplicateRules(rules, adherenceMap);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0].id).toBe('r2');
  });

  it('does not merge rules below similarity threshold', () => {
    const rules = [
      makeRule('r1', 'Use pnpm not npm for package management'),
      makeRule('r2', 'Write comprehensive unit tests for all modules'),
    ];

    const adherenceMap = new Map<string, number>();
    adherenceMap.set('r1', 90);
    adherenceMap.set('r2', 80);

    const result = deduplicateRules(rules, adherenceMap);
    expect(result.rules).toHaveLength(2);
    expect(result.deduped).toHaveLength(0);
  });

  it('handles empty rule list', () => {
    const result = deduplicateRules([], new Map());
    expect(result.rules).toHaveLength(0);
    expect(result.deduped).toHaveLength(0);
  });
});
