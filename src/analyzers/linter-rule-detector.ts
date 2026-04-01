import type { Rule, Diagnostic } from '../parsers/types.js';

/**
 * F1: Detects rules that describe formatting/style concerns that belong
 * in a linter or formatter (eslint, prettier, biome), not in CLAUDE.md.
 *
 * "Never send an LLM to do a linter's job."
 */

const LINTER_PATTERNS: Array<{ pattern: RegExp; tool: string }> = [
  // Indentation
  { pattern: /\b(2|4|tab)\s*(space|indent)/i, tool: 'prettier/eslint' },
  { pattern: /\bindent(ation|ing)\b/i, tool: 'prettier/eslint' },

  // Semicolons
  { pattern: /\bsemicolon/i, tool: 'prettier/eslint' },
  { pattern: /\b(always|never)\s+use\s+semicolons?\b/i, tool: 'prettier/eslint' },

  // Quotes
  { pattern: /\b(single|double)\s+(quotes?|quotation)/i, tool: 'prettier/eslint' },

  // Trailing commas
  { pattern: /\btrailing\s+comma/i, tool: 'prettier/eslint' },

  // Line length / max line
  { pattern: /\b(line\s+length|max.?line|characters?\s+per\s+line)\b/i, tool: 'prettier/eslint' },
  { pattern: /\blines?\s+(should|must|no)\s+(be\s+)?(longer|shorter|exceed|under|over)\s+\d+/i, tool: 'prettier/eslint' },

  // Import sorting
  { pattern: /\bsort\s+imports?\b/i, tool: 'eslint (eslint-plugin-import)' },
  { pattern: /\bimport\s+order(ing)?\b/i, tool: 'eslint (eslint-plugin-import)' },

  // Braces / brackets style
  { pattern: /\b(opening|closing)\s+(brace|bracket|curly)\b/i, tool: 'prettier/eslint' },
  { pattern: /\bsame.?line\s+(brace|bracket|curly)\b/i, tool: 'prettier/eslint' },

  // Whitespace
  { pattern: /\btrailing\s+(whitespace|spaces?)\b/i, tool: 'prettier/eslint' },
  { pattern: /\b(no|avoid)\s+trailing\s+(whitespace|spaces?)\b/i, tool: 'prettier/eslint' },

  // Blank lines
  { pattern: /\b(no\s+)?consecutive\s+blank\s+lines?\b/i, tool: 'prettier/eslint' },
  { pattern: /\b(max|maximum)\s+\d+\s+blank\s+lines?\b/i, tool: 'prettier/eslint' },

  // Naming conventions (when purely about casing)
  { pattern: /\b(camelCase|snake_case|PascalCase|kebab-case)\s+(for|naming|convention)\b/i, tool: 'eslint (naming-convention)' },

  // Parentheses spacing
  { pattern: /\bspac(e|ing)\s+(before|after|around)\s+(parenthes|paren|bracket|brace)/i, tool: 'prettier/eslint' },
];

export function detectLinterRules(rules: Rule[]): Rule[] {
  return rules.map((rule) => {
    const match = LINTER_PATTERNS.find(({ pattern }) => pattern.test(rule.text));
    if (!match) return rule;

    const diagnostic: Diagnostic = {
      severity: 'warning',
      code: 'LINTER_JOB',
      message: `This rule describes formatting/style that belongs in ${match.tool}, not CLAUDE.md. Move it to your linter/formatter config.`,
      placement: {
        target: 'tool-config',
        confidence: 'high',
        detail: match.tool,
      },
    };

    return {
      ...rule,
      diagnostics: [...rule.diagnostics, diagnostic],
    };
  });
}
