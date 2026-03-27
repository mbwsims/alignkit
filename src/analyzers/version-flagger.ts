import type { Rule, Diagnostic } from '../parsers/types.js';

const VERSION_PATTERNS = [
  /v\d+/i,
  /\d+\.\d+(\.\d+)?/,
  /\d+\.x/i,
  />=?\s*\d+/,
];

export function flagVersions(rules: Rule[]): Rule[] {
  return rules.map((rule) => {
    const hasVersion = VERSION_PATTERNS.some((pattern) => pattern.test(rule.text));
    if (!hasVersion) {
      return rule;
    }

    const diagnostic: Diagnostic = {
      severity: 'warning',
      code: 'STALE',
      message:
        'This rule contains a pinned version number, which may become stale. Consider removing the version pin or using a range like "latest stable".',
    };

    return {
      ...rule,
      diagnostics: [...rule.diagnostics, diagnostic],
    };
  });
}
