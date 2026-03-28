import type { Rule, Diagnostic } from '../parsers/types.js';

const TOOL_GROUPS: string[][] = [
  ['pnpm', 'npm', 'yarn', 'bun'],
  ['jest', 'vitest', 'mocha'],
  ['webpack', 'vite', 'turbopack', 'esbuild'],
];

function getToolGroup(text: string): string[] | null {
  const lower = text.toLowerCase();
  for (const group of TOOL_GROUPS) {
    const matches = group.filter((tool) => {
      // Match whole words
      const regex = new RegExp(`\\b${tool}\\b`);
      return regex.test(lower);
    });
    if (matches.length > 0) return group;
  }
  return null;
}

function getMatchedToolsInGroup(text: string, group: string[]): string[] {
  const lower = text.toLowerCase();
  return group.filter((tool) => {
    const regex = new RegExp(`\\b${tool}\\b`);
    return regex.test(lower);
  });
}

function extractMeaningfulWords(text: string): Set<string> {
  const stop = new Set(['use', 'the', 'a', 'an', 'and', 'or', 'in', 'for', 'to', 'with', 'is', 'are', 'always', 'never']);
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !stop.has(w))
  );
}

function hasSharedKeywords(textA: string, textB: string): boolean {
  const wordsA = extractMeaningfulWords(textA);
  const wordsB = extractMeaningfulWords(textB);
  return [...wordsA].some((w) => wordsB.has(w));
}

/**
 * Extract the verb phrase after always/never/don't.
 * E.g., "Always show user feedback" → "show"
 *       "NEVER swallow errors" → "swallow"
 */
function extractActionVerb(text: string): string | null {
  const match = text.match(/\b(?:always|never|don'?t|do not)\s+(\w+)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function isNegationConflict(textA: string, textB: string): boolean {
  const lowerA = textA.toLowerCase();
  const lowerB = textB.toLowerCase();

  const aHasAlways = /\balways\b/.test(lowerA);
  const bHasAlways = /\balways\b/.test(lowerB);
  const aHasNever = /\bnever\b/.test(lowerA);
  const bHasNever = /\bnever\b/.test(lowerB);
  const aHasDontUse = /\bdon'?t use\b|\bdo not use\b/.test(lowerA);
  const bHasDontUse = /\bdon'?t use\b|\bdo not use\b/.test(lowerB);

  const negationMatch =
    (aHasAlways && bHasNever) ||
    (aHasNever && bHasAlways) ||
    (aHasAlways && bHasDontUse) ||
    (aHasDontUse && bHasAlways);

  if (!negationMatch) return false;

  // Require that the action verb after always/never is the SAME word,
  // not just any shared keyword. "Always show" vs "Never show" = conflict.
  // "Always show" vs "Never swallow" = complementary, not a conflict.
  const verbA = extractActionVerb(textA);
  const verbB = extractActionVerb(textB);
  if (verbA && verbB && verbA === verbB) return true;

  // Fallback: if we can't extract verbs, check for high keyword overlap
  // (more than one shared meaningful word, suggesting the same topic AND action)
  const wordsA = extractMeaningfulWords(textA);
  const wordsB = extractMeaningfulWords(textB);
  const shared = [...wordsA].filter((w) => wordsB.has(w));
  return shared.length >= 3;
}

export function detectConflicts(rules: Rule[]): Rule[] {
  const diagnosticsMap = new Map<number, Diagnostic[]>();
  for (let i = 0; i < rules.length; i++) {
    diagnosticsMap.set(i, []);
  }

  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const ruleA = rules[i];
      const ruleB = rules[j];

      let conflictReason: string | null = null;

      // Check tool conflicts
      const groupA = getToolGroup(ruleA.text);
      const groupB = getToolGroup(ruleB.text);

      if (groupA && groupB && groupA === groupB) {
        const toolsA = getMatchedToolsInGroup(ruleA.text, groupA);
        const toolsB = getMatchedToolsInGroup(ruleB.text, groupB);
        // Conflict if rules reference different tools from the same group
        const toolsOnlyInA = toolsA.filter((t) => !toolsB.includes(t));
        const toolsOnlyInB = toolsB.filter((t) => !toolsA.includes(t));
        if (toolsOnlyInA.length > 0 && toolsOnlyInB.length > 0) {
          conflictReason = `Tool conflict: rule references ${toolsOnlyInA.join(', ')} but another rule references ${toolsOnlyInB.join(', ')} from the same tool group.`;
        }
      }

      // Check negation conflicts
      if (!conflictReason && isNegationConflict(ruleA.text, ruleB.text)) {
        conflictReason = `Negation conflict: one rule says "always" while the other says "never" for the same subject.`;
      }

      if (conflictReason) {
        diagnosticsMap.get(i)!.push({
          severity: 'error',
          code: 'CONFLICT',
          message: conflictReason,
          relatedRuleId: ruleB.id,
        });
        diagnosticsMap.get(j)!.push({
          severity: 'error',
          code: 'CONFLICT',
          message: conflictReason,
          relatedRuleId: ruleA.id,
        });
      }
    }
  }

  return rules.map((rule, i) => {
    const newDiags = diagnosticsMap.get(i)!;
    if (newDiags.length === 0) return rule;
    return {
      ...rule,
      diagnostics: [...rule.diagnostics, ...newDiags],
    };
  });
}
