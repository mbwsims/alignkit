import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import type { Command } from 'commander';
import { ANALYSIS_VERSION } from '../history/analysis-version.js';
import { discoverInstructionTargets } from '../parsers/auto-detect.js';
import { parseInstructionFile } from '../parsers/auto-detect.js';
import { loadEffectiveInstructionGraph } from '../parsers/instruction-loader.js';
import { HistoryStore } from '../history/store.js';
import type { SessionResult } from '../history/types.js';
import type { Rule } from '../parsers/types.js';
import { deduplicateRules } from '../optimizer/deduplicator.js';
import { reorderRules } from '../optimizer/reorderer.js';
import { flagRules } from '../optimizer/flagger.js';
import { writeDiff } from '../optimizer/diff-writer.js';
import { analyzeDeep } from '../analyzers/deep-analyzer.js';
import { createDeepSpinner } from './spinner.js';

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

export interface OptimizeTargetDocument {
  filePath: string;
  frontmatterBlock: string | null;
  importLines: string[];
  style: 'markdown' | 'plain';
  rules: Rule[];
  hasExternalGraph: boolean;
}

function extractFrontmatterBlock(content: string): string | null {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') {
    return null;
  }

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return lines.slice(0, i + 1).join('\n');
    }
  }

  return null;
}

function stripLeadingFrontmatter(content: string): string {
  const frontmatter = extractFrontmatterBlock(content);
  if (!frontmatter) {
    return content;
  }

  return content.slice(frontmatter.length).replace(/^\n/, '');
}

function extractImportLines(content: string): string[] {
  const body = stripLeadingFrontmatter(content);
  const lines = body.split('\n');
  const imports: string[] = [];
  let inCodeFence = false;

  for (const rawLine of lines) {
    if (/^```/.test(rawLine.trim())) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence) continue;

    const trimmed = rawLine.trim();
    if (/^(?:[-*]\s+|\d+\.\s+)?@[^\s]+$/.test(trimmed)) {
      imports.push(trimmed);
    }
  }

  return imports;
}

function hasMarkdownStructure(content: string): boolean {
  return /(^#{1,6}\s)|(^[-*]\s)|(^\d+\.\s)|(^```)/m.test(content);
}

export function getOptimizedOutputFileName(filePath: string): string {
  const parsed = path.parse(filePath);

  if (parsed.base.startsWith('.') && parsed.ext === '') {
    return `${parsed.base}.optimized`;
  }

  return `${parsed.name}.optimized${parsed.ext}`;
}

export function analyzeOptimizeTarget(
  filePath: string,
  cwd: string,
  graph = loadEffectiveInstructionGraph(filePath, cwd),
): OptimizeTargetDocument {
  const resolvedPath = path.resolve(filePath);
  const content = readFileSync(resolvedPath, 'utf-8');
  const body = stripLeadingFrontmatter(content);

  return {
    filePath: resolvedPath,
    frontmatterBlock: extractFrontmatterBlock(content),
    importLines: extractImportLines(content),
    style: hasMarkdownStructure(body) || path.extname(resolvedPath) !== '' ? 'markdown' : 'plain',
    rules: parseInstructionFile(content, resolvedPath, cwd),
    hasExternalGraph: graph.loadedFiles.some((loaded) => path.resolve(loaded) !== resolvedPath),
  };
}

export function reconstructInstructionDocument(
  document: OptimizeTargetDocument,
  rules: Rule[],
): string {
  const parts: string[] = [];

  if (document.frontmatterBlock) {
    parts.push(document.frontmatterBlock.trimEnd());
  }

  if (document.importLines.length > 0) {
    parts.push(document.importLines.join('\n'));
  }

  if (rules.length > 0) {
    const hasSections = rules.some((rule) => rule.source.section !== null);
    if (document.style === 'plain' && !hasSections) {
      parts.push(rules.map((rule) => rule.text).join('\n'));
    } else {
      parts.push(reconstructMarkdown(rules).trimEnd());
    }
  }

  if (parts.length === 0) {
    return '\n';
  }

  return parts.join('\n\n') + '\n';
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
    .option('--deep', 'Use LLM to consolidate overlapping rules (requires ANTHROPIC_API_KEY)')
    .option('--format <format>', 'Output format', 'terminal')
    .action(async (file: string | undefined, options: { prune?: boolean; deep?: boolean; format: string }) => {
      const cwd = process.cwd();

      // 1. Auto-discover instruction file
      let filePath: string;

      if (file) {
        filePath = path.resolve(cwd, file);
      } else {
        const discovered = discoverInstructionTargets(cwd);
        if (discovered.length === 0) {
          console.error('No instruction files found. Run `alignkit init` to create one.');
          process.exit(1);
        }
        filePath = discovered[0].absolutePath;
      }

      // 2. Parse the effective graph for history epoch lookup, but only
      // optimize rules physically defined in the target file.
      const graph = loadEffectiveInstructionGraph(filePath, cwd);
      const document = analyzeOptimizeTarget(filePath, cwd, graph);
      const originalRules = document.rules;

      // 3. Load history if available
      const alignkitDir = path.join(cwd, '.alignkit');
      const store = new HistoryStore(alignkitDir);
      const rulesVersion = graph.graphHash;
      const sessions = store.queryByEpoch(rulesVersion, ANALYSIS_VERSION);
      const hasSessionData = sessions.length > 0;
      const { adherenceMap, relevanceMap } = computeMaps(originalRules, sessions);

      // Step 1: Deduplicate (always works — uses text similarity)
      const { rules: dedupedRules, deduped } = deduplicateRules(originalRules, adherenceMap);

      // Step 2: Reorder within sections
      // With session data: sort by adherence (highest first)
      // Without: sort by category priority (tool constraints and process rules first)
      const reorderedRules = hasSessionData
        ? reorderRules(dedupedRules, adherenceMap)
        : reorderByPriority(dedupedRules);

      // Step 3: Deep consolidation — use LLM to merge overlapping rules
      let consolidatedRules = reorderedRules;
      let consolidationCount = 0;
      let consolidationTokensSaved = 0;

      if (options.deep) {
        if (!process.env.ANTHROPIC_API_KEY) {
          console.error('Error: --deep requires ANTHROPIC_API_KEY.\n');
          console.error('  export ANTHROPIC_API_KEY=sk-ant-...\n');
          console.error('Get a key at https://console.anthropic.com/settings/keys');
          process.exit(1);
        }
        const spinner = options.format === 'terminal' ? createDeepSpinner() : null;
        try {
          const projectDir = path.dirname(filePath);
          const deepResult = await analyzeDeep(reorderedRules, projectDir);
          if (deepResult && deepResult.result.consolidation.length > 0) {
            // Apply each consolidation: replace the first rule in the group
            // with the merged text, remove the rest
            const rulesToRemove = new Set<string>();
            for (const merge of deepResult.result.consolidation) {
              const matchedIds = merge.ruleIds
                .map((idPrefix) => consolidatedRules.find((r) => r.id.startsWith(idPrefix))?.id)
                .filter(Boolean) as string[];

              if (matchedIds.length < 2) continue;

              // Replace first rule's text with merged text
              const firstId = matchedIds[0];
              consolidatedRules = consolidatedRules.map((r) =>
                r.id === firstId ? { ...r, text: merge.mergedText } : r,
              );

              // Mark the rest for removal
              for (const id of matchedIds.slice(1)) {
                rulesToRemove.add(id);
              }

              consolidationCount++;
              consolidationTokensSaved += merge.tokenSavings;
            }

            consolidatedRules = consolidatedRules.filter((r) => !rulesToRemove.has(r.id));
          }
          spinner?.succeed('Deep consolidation complete');
        } catch (err) {
          spinner?.fail('Deep consolidation failed');
          // Continue without consolidation
        }
      }

      // Step 4: Flag rules (only meaningful with session data)
      const flagged = hasSessionData
        ? flagRules(consolidatedRules, adherenceMap, relevanceMap)
        : [];

      // Step 5: Optionally prune never-relevant rules (requires session data)
      let finalRules = consolidatedRules;
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

      const outputFileName = getOptimizedOutputFileName(filePath);
      const outputPath = path.join(cwd, outputFileName);
      const diffPath = path.join(cwd, 'alignkit-diff.md');

      writeFileSync(outputPath, reconstructInstructionDocument(document, finalRules), 'utf-8');
      writeDiff(originalRules, finalRules, deduped, flagged, diffPath);

      // 6. Output summary
      // Compare tokens of rules only (not the full file with documentation)
      const beforeContent = reconstructInstructionDocument(document, originalRules);
      const beforeTokens = estimateTokens(beforeContent);
      const afterContent = reconstructInstructionDocument(document, finalRules);
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
          console.log(pc.dim('No session history — optimizing structure only (ordering, dedup).'));
          console.log(pc.dim(`Run ${pc.cyan('alignkit check')} first for adherence-based optimization.`));
          console.log('');
        }
        if (document.hasExternalGraph) {
          console.log(pc.dim(`Optimizing only rules defined in ${path.basename(filePath)}. Imported and stacked rules stay in their source files.`));
          console.log('');
        }

        let stepNum = 1;
        console.log(
          `Step ${stepNum++} \u2014 Deduplicate:      Merged ${deduped.length} near-duplicate rule pair${deduped.length === 1 ? '' : 's'} (saves ~${tokenSaved} tokens)`,
        );
        console.log(
          `Step ${stepNum++} \u2014 Reorder:          ${hasSessionData ? 'Moved top-performing rules to top of each section' : 'Moved actionable rules (tool constraints, process ordering) to top'}`,
        );
        if (options.deep) {
          console.log(
            `Step ${stepNum++} \u2014 Consolidate:      Merged ${consolidationCount} rule group${consolidationCount === 1 ? '' : 's'} via LLM (saves ~${consolidationTokensSaved} tokens)`,
          );
        }
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
