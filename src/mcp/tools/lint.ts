import { readFileSync } from 'node:fs';
import path from 'node:path';
import { discoverInstructionFiles, parseInstructionFile } from '../../parsers/auto-detect.js';
import { detectVague } from '../../analyzers/vague-detector.js';
import { detectDuplicates } from '../../analyzers/duplicate-detector.js';
import { detectConflicts } from '../../analyzers/conflict-detector.js';
import { flagVersions } from '../../analyzers/version-flagger.js';
import { analyzeOrdering } from '../../analyzers/ordering-analyzer.js';
import { analyzeTokens } from '../../analyzers/token-counter.js';
import { collectProjectContext } from '../../analyzers/project-context.js';
import type { TokenAnalysis } from '../../analyzers/types.js';
import type { ProjectContext } from '../../analyzers/project-context.js';

export interface LintToolResult {
  file: string;
  ruleCount: number;
  rules: Array<{
    text: string;
    category: string;
    verifiability: string;
    diagnostics: Array<{ code: string; severity: string; message: string }>;
  }>;
  tokenAnalysis: TokenAnalysis;
  projectContext: ProjectContext;
  quickWins: string[];
}

function computeQuickWins(
  rules: LintToolResult['rules'],
  tokenAnalysis: TokenAnalysis,
): string[] {
  const wins: string[] = [];

  const vagueCount = rules.filter((r) =>
    r.diagnostics.some((d) => d.code === 'VAGUE'),
  ).length;
  if (vagueCount > 0) {
    wins.push(
      `Rewrite ${vagueCount} vague rule${vagueCount > 1 ? 's' : ''} with concrete, actionable language.`,
    );
  }

  const redundantCount = rules.filter((r) =>
    r.diagnostics.some((d) => d.code === 'REDUNDANT'),
  ).length;
  if (redundantCount > 0) {
    wins.push(
      `Consolidate ${redundantCount} redundant rule${redundantCount > 1 ? 's' : ''} to reduce token usage.`,
    );
  }

  const conflictCount = rules.filter((r) =>
    r.diagnostics.some((d) => d.code === 'CONFLICT'),
  ).length;
  if (conflictCount > 0) {
    wins.push(
      `Resolve ${conflictCount} conflicting rule${conflictCount > 1 ? 's' : ''} that send mixed signals.`,
    );
  }

  const orderingCount = rules.filter((r) =>
    r.diagnostics.some((d) => d.code === 'ORDERING'),
  ).length;
  if (orderingCount > 0) {
    wins.push(
      `Move ${orderingCount} high-priority rule${orderingCount > 1 ? 's' : ''} to the top of the file.`,
    );
  }

  if (tokenAnalysis.overBudget) {
    wins.push(
      `Reduce token count from ${tokenAnalysis.tokenCount} to under ${tokenAnalysis.budgetThreshold} (currently ${tokenAnalysis.contextWindowPercent.toFixed(1)}% of context window).`,
    );
  }

  return wins;
}

export function lintTool(cwd: string, file?: string): LintToolResult {
  // 1. Resolve the target file
  let filePath: string;
  let relPath: string;

  if (file) {
    filePath = path.resolve(cwd, file);
    relPath = path.relative(cwd, filePath);
  } else {
    const discovered = discoverInstructionFiles(cwd);
    if (discovered.length === 0) {
      return {
        file: '(none)',
        ruleCount: 0,
        rules: [],
        tokenAnalysis: { tokenCount: 0, contextWindowPercent: 0, overBudget: false, budgetThreshold: 2000 },
        projectContext: { dependencies: [], tsconfig: null, directoryTree: [] },
        quickWins: ['No instruction files found. Create a CLAUDE.md to get started.'],
      };
    }
    filePath = discovered[0].absolutePath;
    relPath = discovered[0].relativePath;
  }

  // 2. Parse into rules
  const content = readFileSync(filePath, 'utf-8');
  let rules = parseInstructionFile(content, filePath);

  // 3. Run all static analyzers
  rules = detectVague(rules);
  rules = detectDuplicates(rules);
  rules = detectConflicts(rules);
  rules = flagVersions(rules);
  rules = analyzeOrdering(rules);

  // 4. Token analysis
  const tokenAnalysis = analyzeTokens(rules);

  // 5. Collect project context
  const projectContext = collectProjectContext(cwd);

  // 6. Build result
  const resultRules = rules.map((r) => ({
    text: r.text,
    category: r.category,
    verifiability: r.verifiability,
    diagnostics: r.diagnostics.map((d) => ({
      code: d.code,
      severity: d.severity,
      message: d.message,
    })),
  }));

  const quickWins = computeQuickWins(resultRules, tokenAnalysis);

  return {
    file: relPath,
    ruleCount: rules.length,
    rules: resultRules,
    tokenAnalysis,
    projectContext,
    quickWins,
  };
}
