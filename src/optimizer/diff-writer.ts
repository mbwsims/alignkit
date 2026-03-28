import { writeFileSync } from 'node:fs';
import type { Rule } from '../parsers/types.js';
import type { DeduplicationResult } from './deduplicator.js';
import type { FlaggedRule } from './flagger.js';

/**
 * Write a prose diff file explaining what changed between original and optimized rules.
 */
export function writeDiff(
  original: Rule[],
  optimized: Rule[],
  deduped: DeduplicationResult[],
  flagged: FlaggedRule[],
  outputPath: string,
): void {
  const lines: string[] = [];

  lines.push('# agentlint optimization diff');
  lines.push('');
  lines.push(`Original: ${original.length} rules`);
  lines.push(`Optimized: ${optimized.length} rules`);
  lines.push('');

  if (deduped.length > 0) {
    lines.push('## Deduplicated rules');
    lines.push('');
    for (const d of deduped) {
      lines.push(`- **Removed:** "${d.removed.text}"`);
      lines.push(`  **Kept:** "${d.kept.text}"`);
      lines.push(`  Similarity: ${Math.round(d.similarity * 100)}%`);
      lines.push('');
    }
  }

  const lowAdherence = flagged.filter((f) => f.reason === 'low-adherence');
  const neverRelevant = flagged.filter((f) => f.reason === 'never-relevant');

  if (lowAdherence.length > 0) {
    lines.push('## Low-adherence rules (flagged for review)');
    lines.push('');
    for (const f of lowAdherence) {
      lines.push(`- "${f.rule.text}" — ${f.adherence}% adherence`);
    }
    lines.push('');
  }

  if (neverRelevant.length > 0) {
    lines.push('## Never-relevant rules');
    lines.push('');
    for (const f of neverRelevant) {
      const action = optimized.some((r) => r.id === f.rule.id) ? 'flagged' : 'removed';
      lines.push(`- "${f.rule.text}" — ${action}`);
    }
    lines.push('');
  }

  writeFileSync(outputPath, lines.join('\n'), 'utf-8');
}
