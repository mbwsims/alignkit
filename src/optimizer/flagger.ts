import type { Rule } from '../parsers/types.js';

export interface FlaggedRule {
  rule: Rule;
  reason: 'low-adherence' | 'never-relevant';
  adherence?: number;
}

/**
 * Flag rules that need attention: low adherence or never relevant.
 */
export function flagRules(
  rules: Rule[],
  adherenceMap: Map<string, number>,
  relevanceMap: Map<string, number>,
  threshold: number = 20,
): FlaggedRule[] {
  const flagged: FlaggedRule[] = [];

  for (const rule of rules) {
    const relevantCount = relevanceMap.get(rule.id) ?? 0;
    if (relevantCount === 0) {
      flagged.push({ rule, reason: 'never-relevant' });
      continue;
    }

    const adherence = adherenceMap.get(rule.id) ?? 0;
    if (adherence < threshold) {
      flagged.push({ rule, reason: 'low-adherence', adherence });
    }
  }

  return flagged;
}
