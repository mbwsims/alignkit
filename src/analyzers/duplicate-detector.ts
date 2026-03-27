import type { Rule, Diagnostic } from '../parsers/types.js';

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'it', 'its', 'this', 'that',
  'these', 'those', 'all', 'not', 'no', 'so', 'up', 'out', 'as', 'if',
  'when', 'then', 'than', 'into', 'over', 'after', 'before',
]);

const JACCARD_THRESHOLD = 0.4;

function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

export function detectDuplicates(rules: Rule[]): Rule[] {
  // Pre-tokenize all rules
  const tokenSets = rules.map((r) => tokenize(r.text));

  // Map from rule index to diagnostics to add
  const diagnosticsMap = new Map<number, Diagnostic[]>();
  for (let i = 0; i < rules.length; i++) {
    diagnosticsMap.set(i, []);
  }

  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const similarity = jaccardSimilarity(tokenSets[i], tokenSets[j]);
      if (similarity >= JACCARD_THRESHOLD) {
        const diagI: Diagnostic = {
          severity: 'warning',
          code: 'REDUNDANT',
          message: `This rule is similar to another rule: "${rules[j].text}"`,
          relatedRuleId: rules[j].id,
        };
        const diagJ: Diagnostic = {
          severity: 'warning',
          code: 'REDUNDANT',
          message: `This rule is similar to another rule: "${rules[i].text}"`,
          relatedRuleId: rules[i].id,
        };
        diagnosticsMap.get(i)!.push(diagI);
        diagnosticsMap.get(j)!.push(diagJ);
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
