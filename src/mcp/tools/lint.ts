import path from 'node:path';
import { discoverLintTargets } from '../../parsers/auto-detect.js';
import { loadEffectiveInstructionGraph } from '../../parsers/instruction-loader.js';
import { detectVague } from '../../analyzers/vague-detector.js';
import { detectDuplicates } from '../../analyzers/duplicate-detector.js';
import { detectConflicts } from '../../analyzers/conflict-detector.js';
import { flagVersions } from '../../analyzers/version-flagger.js';
import { analyzeOrdering } from '../../analyzers/ordering-analyzer.js';
import { detectLinterRules } from '../../analyzers/linter-rule-detector.js';
import { advisePlacement } from '../../analyzers/placement-advisor.js';
import { validateInstructionMetadata } from '../../analyzers/instruction-metadata-validator.js';
import { analyzeTokens } from '../../analyzers/token-counter.js';
import { collectProjectContext } from '../../analyzers/project-context.js';
import type { TokenAnalysis } from '../../analyzers/types.js';
import type { ProjectContext } from '../../analyzers/project-context.js';

export interface LintToolResult {
  file: string;
  ruleCount: number;
  fileDiagnostics: Array<{
    code: string;
    severity: string;
    message: string;
  }>;
  rules: Array<{
    text: string;
    category: string;
    verifiability: string;
    applicability?: {
      kind: string;
      patterns: string[];
      source: string;
    };
    diagnostics: Array<{
      code: string;
      severity: string;
      message: string;
      placement?: {
        target: string;
        confidence: string;
        detail?: string;
      };
    }>;
  }>;
  tokenAnalysis: TokenAnalysis;
  projectContext: ProjectContext;
  quickWins: string[];
}

function computeQuickWins(
  fileDiagnostics: LintToolResult['fileDiagnostics'],
  rules: LintToolResult['rules'],
  tokenAnalysis: TokenAnalysis,
): string[] {
  const wins: string[] = [];

  const metadataCount = fileDiagnostics.filter((diagnostic) => diagnostic.code === 'METADATA').length;
  if (metadataCount > 0) {
    wins.push(
      `Fix ${metadataCount} instruction metadata issue${metadataCount > 1 ? 's' : ''} before relying on this file.`,
    );
  }

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

  const scopedPlacementCount = rules.filter((r) =>
    r.diagnostics.some((d) => d.code === 'PLACEMENT' && d.placement?.target === 'scoped-rule'),
  ).length;
  if (scopedPlacementCount > 0) {
    wins.push(
      `Move ${scopedPlacementCount} path-specific rule${scopedPlacementCount > 1 ? 's' : ''} into .claude/rules/.`,
    );
  }

  const hookPlacementCount = rules.filter((r) =>
    r.diagnostics.some((d) => d.code === 'PLACEMENT' && d.placement?.target === 'hook'),
  ).length;
  if (hookPlacementCount > 0) {
    wins.push(
      `Convert ${hookPlacementCount} deterministic automation rule${hookPlacementCount > 1 ? 's' : ''} into Claude hooks.`,
    );
  }

  const subagentPlacementCount = rules.filter((r) =>
    r.diagnostics.some((d) => d.code === 'PLACEMENT' && d.placement?.target === 'subagent'),
  ).length;
  if (subagentPlacementCount > 0) {
    wins.push(
      `Move ${subagentPlacementCount} reusable workflow rule${subagentPlacementCount > 1 ? 's' : ''} into .claude/agents/.`,
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
    const discovered = discoverLintTargets(cwd);
    if (discovered.length === 0) {
      return {
        file: '(none)',
        ruleCount: 0,
        fileDiagnostics: [],
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
  let rules = loadEffectiveInstructionGraph(filePath, cwd).rules;
  const fileDiagnostics = validateInstructionMetadata(filePath, rules);

  // 3. Run all static analyzers
  rules = detectVague(rules);
  rules = detectDuplicates(rules);
  rules = detectConflicts(rules);
  rules = flagVersions(rules);
  rules = analyzeOrdering(rules);
  rules = detectLinterRules(rules);
  rules = advisePlacement(rules, cwd);

  // 4. Token analysis
  const tokenAnalysis = analyzeTokens(rules);

  // 5. Collect project context
  const projectContext = collectProjectContext(cwd);

  // 6. Build result
  const resultRules = rules.map((r) => ({
    text: r.text,
    category: r.category,
    verifiability: r.verifiability,
    applicability: r.applicability
      ? {
          kind: r.applicability.kind,
          patterns: r.applicability.patterns,
          source: r.applicability.source,
        }
      : undefined,
    diagnostics: r.diagnostics.map((d) => ({
      code: d.code,
      severity: d.severity,
      message: d.message,
      placement: d.placement
        ? {
            target: d.placement.target,
            confidence: d.placement.confidence,
            detail: d.placement.detail,
          }
        : undefined,
    })),
  }));

  const resultFileDiagnostics = fileDiagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
  }));

  const quickWins = computeQuickWins(resultFileDiagnostics, resultRules, tokenAnalysis);

  return {
    file: relPath,
    ruleCount: rules.length,
    fileDiagnostics: resultFileDiagnostics,
    rules: resultRules,
    tokenAnalysis,
    projectContext,
    quickWins,
  };
}
