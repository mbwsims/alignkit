import type { Rule } from '../parsers/types.js';

export interface DeduplicationResult {
  kept: Rule;
  removed: Rule;
  similarity: number;
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'it', 'its', 'this', 'that',
  'these', 'those', 'all', 'not', 'no', 'so', 'up', 'out', 'as', 'if',
  'when', 'then', 'than', 'into', 'over', 'after', 'before',
]);

const JACCARD_THRESHOLD = 0.6;

function tokenize(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return new Set(words);
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

export function deduplicateRules(
  rules: Rule[],
  adherenceMap: Map<string, number>,
): { rules: Rule[]; deduped: DeduplicationResult[] } {
  const tokenSets = rules.map((r) => tokenize(r.text));
  const removed = new Set<number>();
  const deduped: DeduplicationResult[] = [];

  for (let i = 0; i < rules.length; i++) {
    if (removed.has(i)) continue;
    for (let j = i + 1; j < rules.length; j++) {
      if (removed.has(j)) continue;
      const similarity = jaccardSimilarity(tokenSets[i], tokenSets[j]);
      if (similarity >= JACCARD_THRESHOLD) {
        const adhI = adherenceMap.get(rules[i].id) ?? 0;
        const adhJ = adherenceMap.get(rules[j].id) ?? 0;

        // Keep the one with higher adherence
        if (adhI >= adhJ) {
          removed.add(j);
          deduped.push({ kept: rules[i], removed: rules[j], similarity });
        } else {
          removed.add(i);
          deduped.push({ kept: rules[j], removed: rules[i], similarity });
          break; // rule i is removed, stop comparing it
        }
      }
    }
  }

  const remaining = rules.filter((_, idx) => !removed.has(idx));
  return { rules: remaining, deduped };
}
