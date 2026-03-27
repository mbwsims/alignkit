import type { Rule, Diagnostic, RuleCategory } from '../parsers/types.js';

const HIGH_PRIORITY_CATEGORIES: RuleCategory[] = ['tool-constraint', 'process-ordering'];

export function analyzeOrdering(rules: Rule[]): Rule[] {
  if (rules.length < 4) {
    return rules;
  }

  const maxLine = Math.max(...rules.map((r) => r.source.lineStart));
  const midpoint = maxLine / 2;

  return rules.map((rule) => {
    const isHighPriority = HIGH_PRIORITY_CATEGORIES.includes(rule.category);
    const isInBottomHalf = rule.source.lineStart > midpoint;

    if (!isHighPriority || !isInBottomHalf) {
      return rule;
    }

    const diagnostic: Diagnostic = {
      severity: 'warning',
      code: 'ORDERING',
      message:
        `High-priority rule (category: ${rule.category}) appears in the bottom half of the file (line ${rule.source.lineStart}). Move tool constraints and process rules to the top of the file so agents encounter them first.`,
    };

    return {
      ...rule,
      diagnostics: [...rule.diagnostics, diagnostic],
    };
  });
}
