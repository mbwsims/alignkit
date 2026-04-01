import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import type { Command } from 'commander';
import { ANALYSIS_VERSION } from '../history/analysis-version.js';
import { discoverInstructionFiles, parseInstructionFile } from '../parsers/auto-detect.js';
import { HistoryStore } from '../history/store.js';
import type { SessionResult } from '../history/types.js';
import type { Rule } from '../parsers/types.js';
import { deduplicateRules } from '../optimizer/deduplicator.js';
import { reorderRules } from '../optimizer/reorderer.js';
import { flagRules } from '../optimizer/flagger.js';
import { writeDiff } from '../optimizer/diff-writer.js';

/**
 * Compute per-rule adherence and relevance maps from session history.
 */
export function computeMaps(
  rules: Rule[],
  sessions: SessionResult[],
): { adherenceMap: Map<string, number>; relevanceMap: Map<string, number> } {
  const adherenceMap = new Map<string, number>();
  const relevanceMap = new Map<string, number>();

  for (const rule of rules) {
    let relevant = 0;
    let followed = 0;

    for (const session of sessions) {
      for (const obs of session.observations) {
        if (obs.ruleId === rule.id && obs.relevant) {
          relevant++;
          if (obs.followed === true) followed++;
        }
      }
    }

    relevanceMap.set(rule.id, relevant);
    adherenceMap.set(rule.id, relevant > 0 ? Math.round((followed / relevant) * 100) : 0);
  }

  return { adherenceMap, relevanceMap };
}

/**
 * Reconstruct a markdown file from rules grouped by section.
 */
export function reconstructMarkdown(rules: Rule[]): string {
  const lines: string[] = [];
  let currentSection: string | null | undefined = undefined;

  for (const rule of rules) {
    const section = rule.source.section;
    if (section !== currentSection) {
      if (lines.length > 0) lines.push('');
      if (section) {
        lines.push(`## ${section}`);
        lines.push('');
      }
      currentSection = section;
    }
    lines.push(`- ${rule.text}`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Reorder rules by category priority when no session data is available.
 * Tool constraints and process ordering rules go first (most actionable),
 * followed by code structure, then everything else.
 */
const CATEGORY_PRIORITY: Record<string, number> = {
  'tool-constraint': 1,
  'process-ordering': 2,
  'code-structure': 3,
  'meta': 4,
  'style-guidance': 5,
  'behavioral': 6,
};

function reorderByPriority(rules: Rule[]): Rule[] {
  // Group by section, reorder within each section
  const sections = new Map<string | null, Rule[]>();
  for (const rule of rules) {
    const section = rule.source.section;
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)!.push(rule);
  }

  const result: Rule[] = [];
  for (const [, sectionRules] of sections) {
    sectionRules.sort((a, b) => {
      const pa = CATEGORY_PRIORITY[a.category] ?? 99;
      const pb = CATEGORY_PRIORITY[b.category] ?? 99;
      return pa - pb;
    });
    result.push(...sectionRules);
  }
  return result;
}

/**
 * Estimate token count (rough: ~4 chars per token).
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function registerOptimizeCommand(program: Command): void {
  program
    .command('optimize [file]')
    .description('Optimize instruction file based on adherence data')
    .option('--prune', 'Remove rules that were never relevant')
    .option('--deep', 'Add LLM consolidation step')
    .option('--format <format>', 'Output format', 'terminal')
    .action(async (file: string | undefined, options: { prune?: boolean; deep?: boolean; format: string }) => {
      const cwd = process.cwd();

      // 1. Auto-discover instruction file
      let filePath: string;

      if (file) {
        filePath = path.resolve(cwd, file);
      } else {
        const discovered = discoverInstructionFiles(cwd);
        if (discovered.length === 0) {
          console.error('Error: No instruction files found.');
          process.exit(1);
        }
        filePath = discovered[0].absolutePath;
      }

      // 2. Parse rules
      const content = readFileSync(filePath, 'utf-8');
      const originalRules = parseInstructionFile(content, filePath);

      // 3. Load history if available (optimize works with or without session data)
      const alignkitDir = path.join(cwd, '.alignkit');
      const store = new HistoryStore(alignkitDir);
      const rulesVersion = HistoryStore.computeRulesVersion(filePath);
      const sessions = store.queryByEpoch(rulesVersion, ANALYSIS_VERSION);
      const hasSessionData = sessions.length > 0;
      const { adherenceMap, relevanceMap } = computeMaps(originalRules, sessions);

      // Step 1: Deduplicate (always works — uses text similarity, not session data)
      const { rules: dedupedRules, deduped } = deduplicateRules(originalRules, adherenceMap);

      // Step 2: Reorder within sections
      // With session data: sort by adherence (highest first)
      // Without session data: sort verifiable rules first, then by category priority
      const reorderedRules = hasSessionData
        ? reorderRules(dedupedRules, adherenceMap)
        : reorderByPriority(dedupedRules);

      // Step 3: Flag for review (only when we have session data to judge)
      const flagged = hasSessionData
        ? flagRules(reorderedRules, adherenceMap, relevanceMap)
        : [];

      // Step 4: Optionally prune never-relevant rules
      let finalRules = reorderedRules;
      if (options.prune && hasSessionData) {
        const neverRelevantIds = new Set(
          flagged.filter((f) => f.reason === 'never-relevant').map((f) => f.rule.id),
        );
        finalRules = reorderedRules.filter((r) => !neverRelevantIds.has(r.id));
      }

      // 5. Write output files
      if (!existsSync(alignkitDir)) {
        mkdirSync(alignkitDir, { recursive: true });
      }

      const outputFileName = path.basename(filePath).replace(/\.md$/, '.optimized.md');
      const outputPath = path.join(cwd, outputFileName);
      const diffPath = path.join(cwd, 'alignkit-diff.md');

      writeFileSync(outputPath, reconstructMarkdown(finalRules), 'utf-8');
      writeDiff(originalRules, finalRules, deduped, flagged, diffPath);

      // 6. Output summary
      // Compare tokens of rules only (not the full file with documentation)
      const beforeContent = reconstructMarkdown(originalRules);
      const beforeTokens = estimateTokens(beforeContent);
      const afterContent = reconstructMarkdown(finalRules);
      const afterTokens = estimateTokens(afterContent);
      const tokenSaved = deduped.reduce((sum, d) => sum + estimateTokens(d.removed.text), 0);
      const neverRelevantCount = flagged.filter((f) => f.reason === 'never-relevant').length;
      const lowAdherenceCount = flagged.filter((f) => f.reason === 'low-adherence').length;

      if (options.format === 'json') {
        console.log(JSON.stringify({
          steps: {
            deduplicate: { merged: deduped.length, tokensSaved: tokenSaved },
            reorder: true,
            flagged: { neverRelevant: neverRelevantCount, lowAdherence: lowAdherenceCount },
          },
          before: { rules: originalRules.length, tokens: beforeTokens },
          after: { rules: finalRules.length, tokens: afterTokens },
          output: outputPath,
          diff: diffPath,
        }, null, 2));
      } else {
        if (!hasSessionData) {
          console.log(pc.dim('No session history found — optimizing based on structural analysis only.'));
          console.log(pc.dim('Run `alignkit check` first for adherence-based optimization.'));
          console.log('');
        }

        let stepNum = 1;
        console.log(
          `Step ${stepNum++} \u2014 Deduplicate:      Merged ${deduped.length} near-duplicate rule pair${deduped.length === 1 ? '' : 's'} (saves ~${tokenSaved} tokens)`,
        );
        console.log(
          `Step ${stepNum++} \u2014 Reorder:          ${hasSessionData ? 'Moved top-performing rules to top of each section' : 'Moved actionable rules (tool constraints, process ordering) to top of each section'}`,
        );
        if (hasSessionData) {
          console.log(
            `Step ${stepNum++} \u2014 Flag for review:  ${flagged.length} rule${flagged.length === 1 ? '' : 's'} need${flagged.length === 1 ? 's' : ''} attention`,
          );
        }
        if (options.prune && hasSessionData) {
          console.log(
            `Step ${stepNum++} \u2014 Prune:            Removed ${neverRelevantCount} never-relevant rule${neverRelevantCount === 1 ? '' : 's'}`,
          );
        }
        console.log('');
        console.log('RESULT:');
        console.log(`  Before: ${originalRules.length} rules, ~${beforeTokens} tokens`);
        console.log(`  After:  ${finalRules.length} rules, ~${afterTokens} tokens`);
        console.log(`  Output: ${outputFileName}`);
        console.log(`  Review: alignkit-diff.md`);
      }
    });
}
