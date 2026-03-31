import type { Rule, Diagnostic } from '../parsers/types.js';

/**
 * F4: Detects high-priority rules (tool-constraint, process-ordering) that
 * use weak language instead of emphasis. Anthropic's docs recommend using
 * "IMPORTANT", "YOU MUST", "NEVER" etc. for critical rules to improve adherence.
 */

const HIGH_PRIORITY_CATEGORIES = new Set(['tool-constraint', 'process-ordering']);

const EMPHASIS_PATTERNS = [
  /\bIMPORTANT\b/,
  /\bCRITICAL\b/,
  /\bMUST\b/,
  /\bNEVER\b/,
  /\bALWAYS\b/,
  /\bREQUIRED\b/,
  /\bDO NOT\b/,
  /\bYOU MUST\b/,
];

const WEAK_PATTERNS = [
  /\bshould\b/i,
  /\bprefer(ably)?\b/i,
  /\bideally\b/i,
  /\bgenerally\b/i,
  /\busually\b/i,
  /\btypically\b/i,
  /\bmight\b/i,
  /\bcould\b/i,
  /\bmay\b/i,
];

function hasEmphasis(text: string): boolean {
  return EMPHASIS_PATTERNS.some((p) => p.test(text));
}

function hasWeakLanguage(text: string): boolean {
  return WEAK_PATTERNS.some((p) => p.test(text));
}

export function detectWeakEmphasis(rules: Rule[]): Rule[] {
  return rules.map((rule) => {
    if (!HIGH_PRIORITY_CATEGORIES.has(rule.category)) return rule;
    if (hasEmphasis(rule.text)) return rule;
    if (!hasWeakLanguage(rule.text)) return rule;

    const diagnostic: Diagnostic = {
      severity: 'warning',
      code: 'WEAK_EMPHASIS',
      message:
        'High-priority rule uses weak language ("should", "prefer", etc.). Use emphatic language (IMPORTANT, MUST, NEVER, ALWAYS) to improve agent adherence.',
    };

    return {
      ...rule,
      diagnostics: [...rule.diagnostics, diagnostic],
    };
  });
}
