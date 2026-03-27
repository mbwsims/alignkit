import type { Rule, RuleCategory } from '../../src/parsers/types.js';
import { generateRuleId, generateSlug } from '../../src/parsers/rule-id.js';

export function makeRule(
  text: string,
  overrides?: { lineStart?: number; category?: RuleCategory }
): Rule {
  return {
    id: generateRuleId(text),
    slug: generateSlug(text),
    text,
    source: {
      file: 'test.md',
      lineStart: overrides?.lineStart ?? 1,
      lineEnd: overrides?.lineStart ?? 1,
      section: null,
    },
    category: overrides?.category ?? 'tool-constraint',
    verifiability: 'auto',
    diagnostics: [],
  };
}
