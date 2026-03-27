import { describe, it, expect } from 'vitest';
import { analyzeOrdering } from '../../src/analyzers/ordering-analyzer.js';
import { makeRule } from './helpers.js';

describe('analyzeOrdering', () => {
  it('flags tool-constraint rules in the bottom half of the file', () => {
    // 20 style rules at lines 1-20, then a tool-constraint rule at line 25
    const styleRules = Array.from({ length: 20 }, (_, i) =>
      makeRule(`Style rule number ${i + 1}`, { lineStart: i + 1, category: 'style-guidance' })
    );
    const toolRule = makeRule('Use pnpm for packages', { lineStart: 25, category: 'tool-constraint' });
    const rules = [...styleRules, toolRule];

    const result = analyzeOrdering(rules);
    const toolRuleResult = result.find((r) => r.text === 'Use pnpm for packages');
    expect(toolRuleResult?.diagnostics).toHaveLength(1);
    expect(toolRuleResult?.diagnostics[0].code).toBe('ORDERING');
  });

  it('does NOT flag tool-constraint rules in the top half', () => {
    // tool-constraint rule at line 1, style rules at lines 10-30
    const toolRule = makeRule('Use pnpm for packages', { lineStart: 1, category: 'tool-constraint' });
    const styleRules = Array.from({ length: 20 }, (_, i) =>
      makeRule(`Style rule number ${i + 1}`, { lineStart: i + 10, category: 'style-guidance' })
    );
    const rules = [toolRule, ...styleRules];

    const result = analyzeOrdering(rules);
    const toolRuleResult = result.find((r) => r.text === 'Use pnpm for packages');
    expect(toolRuleResult?.diagnostics).toHaveLength(0);
  });

  it('skips analysis when fewer than 4 rules', () => {
    const rules = [
      makeRule('Use pnpm for packages', { lineStart: 10, category: 'tool-constraint' }),
      makeRule('Write tests', { lineStart: 1, category: 'style-guidance' }),
    ];
    const result = analyzeOrdering(rules);
    const allDiagnostics = result.flatMap((r) => r.diagnostics);
    expect(allDiagnostics.filter((d) => d.code === 'ORDERING')).toHaveLength(0);
  });

  it('does not mutate input rules', () => {
    const styleRules = Array.from({ length: 20 }, (_, i) =>
      makeRule(`Style rule number ${i + 1}`, { lineStart: i + 1, category: 'style-guidance' })
    );
    const toolRule = makeRule('Use pnpm for packages', { lineStart: 25, category: 'tool-constraint' });
    const rules = [...styleRules, toolRule];
    const original = JSON.stringify(rules);
    analyzeOrdering(rules);
    expect(JSON.stringify(rules)).toBe(original);
  });
});
