import { describe, it, expect } from 'vitest';
import { reorderRules } from '../../src/optimizer/reorderer.js';
import type { Rule } from '../../src/parsers/types.js';

function makeRule(id: string, text: string, section: string | null): Rule {
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

describe('reorderRules', () => {
  it('sorts rules by adherence within a section (highest first)', () => {
    const rules = [
      makeRule('r1', 'Low adherence rule', 'General'),
      makeRule('r2', 'High adherence rule', 'General'),
      makeRule('r3', 'Medium adherence rule', 'General'),
    ];

    const adherenceMap = new Map<string, number>();
    adherenceMap.set('r1', 20);
    adherenceMap.set('r2', 95);
    adherenceMap.set('r3', 60);

    const result = reorderRules(rules, adherenceMap);
    expect(result.map((r) => r.id)).toEqual(['r2', 'r3', 'r1']);
  });

  it('preserves cross-section ordering', () => {
    const rules = [
      makeRule('r1', 'Section A rule low', 'Section A'),
      makeRule('r2', 'Section A rule high', 'Section A'),
      makeRule('r3', 'Section B rule low', 'Section B'),
      makeRule('r4', 'Section B rule high', 'Section B'),
    ];

    const adherenceMap = new Map<string, number>();
    adherenceMap.set('r1', 20);
    adherenceMap.set('r2', 90);
    adherenceMap.set('r3', 10);
    adherenceMap.set('r4', 80);

    const result = reorderRules(rules, adherenceMap);
    // Section A should come first, then Section B
    expect(result[0].id).toBe('r2'); // Section A, high
    expect(result[1].id).toBe('r1'); // Section A, low
    expect(result[2].id).toBe('r4'); // Section B, high
    expect(result[3].id).toBe('r3'); // Section B, low
  });

  it('handles rules with no section', () => {
    const rules = [
      makeRule('r1', 'No section low', null),
      makeRule('r2', 'No section high', null),
    ];

    const adherenceMap = new Map<string, number>();
    adherenceMap.set('r1', 10);
    adherenceMap.set('r2', 90);

    const result = reorderRules(rules, adherenceMap);
    expect(result[0].id).toBe('r2');
    expect(result[1].id).toBe('r1');
  });

  it('handles empty rule list', () => {
    const result = reorderRules([], new Map());
    expect(result).toHaveLength(0);
  });
});
