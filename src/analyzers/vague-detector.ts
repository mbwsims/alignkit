import type { Rule, Diagnostic } from '../parsers/types.js';

const VAGUE_PATTERNS = [
  /be careful/i,
  /try to/i,
  /consider/i,
  /when appropriate/i,
  /as needed/i,
  /if possible/i,
  /think about/i,
  /keep in mind/i,
  /where possible/i,
  /when feasible/i,
];

export function detectVague(rules: Rule[]): Rule[] {
  return rules.map((rule) => {
    const isVague = VAGUE_PATTERNS.some((pattern) => pattern.test(rule.text));
    if (!isVague) {
      return rule;
    }

    const diagnostic: Diagnostic = {
      severity: 'warning',
      code: 'VAGUE',
      message:
        'This rule uses vague language. Rewrite it as a concrete, actionable instruction (e.g., replace "try to" with a specific requirement).',
    };

    return {
      ...rule,
      diagnostics: [...rule.diagnostics, diagnostic],
    };
  });
}
