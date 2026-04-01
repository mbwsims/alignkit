import pc from 'picocolors';
import type { LintResult } from '../analyzers/types.js';
import type { Reporter } from './types.js';
import type { Rule } from '../parsers/types.js';
import { autoMap } from '../verifiers/auto-mapper.js';

const TRUNCATE_LEN = 60;

function truncate(text: string, len = TRUNCATE_LEN): string {
  if (text.length <= len) return text;
  // Truncate at the last space before the limit to avoid cutting mid-word
  const cut = text.lastIndexOf(' ', len - 2);
  return (cut > len * 0.4 ? text.slice(0, cut) : text.slice(0, len - 1)) + '…';
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export class TerminalReporter implements Reporter {
  report(result: LintResult): string {
    const lines: string[] = [];

    // Discovery line when multiple files found
    if (result.discoveredFiles.length > 1) {
      const fileList = result.discoveredFiles.join(', ');
      lines.push(
        pc.cyan(
          `Found ${result.discoveredFiles.length} instruction files: ${fileList}`
        )
      );
      lines.push('');
    }

    // Header
    const tokenStr = formatNumber(result.tokenAnalysis.tokenCount);
    lines.push(
      pc.bold(
        `${result.file} — ${result.rules.length} rules, ~${tokenStr} tokens (estimated)`
      )
    );
    lines.push('');

    // Diagnostics section — only show STATIC diagnostics inline
    // Deep analysis results (EFFECTIVENESS, REWRITE, COVERAGE_GAP, CONSOLIDATION)
    // are shown in their own sections below
    const DEEP_CODES = new Set<string>(['EFFECTIVENESS', 'REWRITE', 'COVERAGE_GAP', 'CONSOLIDATION']);
    const fileDiagnostics = result.fileDiagnostics.map((d) => ({ d }));
    const staticDiagnostics = result.rules.flatMap((rule) =>
      rule.diagnostics
        .filter((d) => !DEEP_CODES.has(d.code))
        .map((d) => ({ rule, d }))
    );

    if (fileDiagnostics.length > 0 || staticDiagnostics.length > 0) {
      for (const { d } of fileDiagnostics) {
        const icon =
          d.severity === 'error'
            ? pc.red('✗')
            : pc.yellow('⚠');
        const code =
          d.severity === 'error'
            ? pc.red(d.code)
            : pc.yellow(d.code);
        lines.push(`  ${icon} ${code}  ${pc.dim('(file)')}`);
        lines.push(`     ${d.message}`);
      }
      for (const { rule, d } of staticDiagnostics) {
        const icon =
          d.severity === 'error'
            ? pc.red('✗')
            : pc.yellow('⚠');
        const code =
          d.severity === 'error'
            ? pc.red(d.code)
            : pc.yellow(d.code);
        const ruleText = pc.dim(truncate(rule.text));
        lines.push(`  ${icon} ${code}  ${ruleText}`);
        lines.push(`     ${d.message}`);
      }
      lines.push('');
    }

    // Compute stats for HEALTH
    const auto = result.rules.filter((r: Rule) => autoMap(r) !== null).length;
    const vague = result.rules.flatMap((r) => r.diagnostics).filter((d) => d.code === 'VAGUE').length;
    const conflicting = result.rules.flatMap((r) => r.diagnostics).filter((d) => d.code === 'CONFLICT').length;
    const redundant = result.rules.flatMap((r) => r.diagnostics).filter((d) => d.code === 'REDUNDANT').length;
    const linterJob = result.rules.flatMap((r) => r.diagnostics).filter((d) => d.code === 'LINTER_JOB').length;
    const placement = result.rules.flatMap((r) => r.diagnostics).filter((d) => d.code === 'PLACEMENT').length;
    const weakEmphasis = result.rules.flatMap((r) => r.diagnostics).filter((d) => d.code === 'WEAK_EMPHASIS').length;
    const pathScoped = result.rules.filter((r) => r.applicability?.kind === 'path-scoped').length;

    // HEALTH summary — includes rule count with recommended ceiling
    const ruleCount = result.rules.length;
    const RULE_CEILING = 150;
    const ruleCountStr = ruleCount > RULE_CEILING
      ? pc.red(`${ruleCount} rules (recommended: under ${RULE_CEILING})`)
      : `${ruleCount} rules`;

    let healthParts = [
      ruleCountStr,
      `${auto} auto-verifiable`,
    ];
    if (vague > 0) healthParts.push(`${vague} vague`);
    if (conflicting > 0) healthParts.push(`${conflicting} conflicting`);
    if (redundant > 0) healthParts.push(`${redundant} redundant`);
    if (linterJob > 0) healthParts.push(`${linterJob} linter-job`);
    if (placement > 0) healthParts.push(`${placement} misplaced`);
    if (weakEmphasis > 0) healthParts.push(`${weakEmphasis} weak-emphasis`);
    if (pathScoped > 0) healthParts.push(`${pathScoped} path-scoped`);

    lines.push(
      `${pc.bold('HEALTH')}  ${healthParts.join(', ')}`
    );

    // TOKENS summary
    const pct = result.tokenAnalysis.contextWindowPercent.toFixed(1);
    const budget = formatNumber(result.tokenAnalysis.budgetThreshold);
    const tokenSummary = `~${tokenStr} (~${pct}% of effective context window). Recommended: under ${budget}.`;
    lines.push(
      `${pc.bold('TOKENS')}  ${result.tokenAnalysis.overBudget ? pc.red(tokenSummary) : tokenSummary}`
    );

    // QUICK WINS — actionable next steps from static analysis
    const quickWins: string[] = [];

    // Redundant rules can be merged
    const redundantPairs = Math.floor(redundant / 2); // each pair produces 2 diagnostics
    if (redundantPairs > 0) {
      const tokenSavings = result.rules
        .flatMap((r) => r.diagnostics)
        .filter((d) => d.code === 'REDUNDANT')
        .length; // rough estimate: each redundant rule ~1 rule worth of tokens
      quickWins.push(`Merge ${redundantPairs} redundant rule pair${redundantPairs > 1 ? 's' : ''} → run ${pc.cyan('alignkit optimize')}`);
    }

    // Ordering issues
    const orderingIssues = result.rules.flatMap((r) => r.diagnostics).filter((d) => d.code === 'ORDERING').length;
    if (orderingIssues > 0) {
      quickWins.push(`Move ${orderingIssues} high-priority rule${orderingIssues > 1 ? 's' : ''} to top of file → run ${pc.cyan('alignkit optimize')}`);
    }

    // Vague rules need rewriting
    if (vague > 0) {
      quickWins.push(`Rewrite ${vague} vague rule${vague > 1 ? 's' : ''} to be concrete → run ${pc.cyan('alignkit lint --deep')} for suggestions`);
    }

    // Stale version references
    const stale = result.rules.flatMap((r) => r.diagnostics).filter((d) => d.code === 'STALE').length;
    if (stale > 0) {
      quickWins.push(`Verify ${stale} version reference${stale > 1 ? 's' : ''} ${stale > 1 ? 'are' : 'is'} current`);
    }

    // Linter-job rules
    if (linterJob > 0) {
      quickWins.push(`Move ${linterJob} formatting rule${linterJob > 1 ? 's' : ''} to linter/formatter config`);
    }

    const scopedRulePlacement = result.rules.flatMap((r) => r.diagnostics)
      .filter((d) => d.code === 'PLACEMENT' && d.placement?.target === 'scoped-rule').length;
    if (scopedRulePlacement > 0) {
      quickWins.push(`Move ${scopedRulePlacement} path-specific rule${scopedRulePlacement > 1 ? 's' : ''} into .claude/rules/`);
    }

    const hookPlacement = result.rules.flatMap((r) => r.diagnostics)
      .filter((d) => d.code === 'PLACEMENT' && d.placement?.target === 'hook').length;
    if (hookPlacement > 0) {
      quickWins.push(`Convert ${hookPlacement} deterministic automation rule${hookPlacement > 1 ? 's' : ''} into Claude hooks`);
    }

    const subagentPlacement = result.rules.flatMap((r) => r.diagnostics)
      .filter((d) => d.code === 'PLACEMENT' && d.placement?.target === 'subagent').length;
    if (subagentPlacement > 0) {
      quickWins.push(`Move ${subagentPlacement} reusable workflow rule${subagentPlacement > 1 ? 's' : ''} into .claude/agents/`);
    }

    // Weak emphasis on critical rules
    if (weakEmphasis > 0) {
      quickWins.push(`Strengthen ${weakEmphasis} critical rule${weakEmphasis > 1 ? 's' : ''} with emphatic language (MUST, NEVER, ALWAYS)`);
    }

    if (quickWins.length > 0) {
      lines.push('');
      lines.push(pc.bold('QUICK WINS'));
      for (const win of quickWins.slice(0, 3)) {
        lines.push(`  → ${win}`);
      }
    }

    // Deep analysis sections
    if (result.deepAnalysis) {
      // Build a lookup that matches by ID prefix (LLM returns 8-char prefixes)
      const findRule = (idPrefix: string): Rule | undefined =>
        result.rules.find((r: Rule) => r.id.startsWith(idPrefix));

      // EFFECTIVENESS PREDICTIONS — skip HIGH, show MEDIUM and LOW
      const effectivenessItems = result.deepAnalysis.effectiveness.filter(
        (e) => e.level !== 'HIGH'
      );
      if (effectivenessItems.length > 0) {
        lines.push('');
        lines.push(pc.bold('EFFECTIVENESS PREDICTIONS'));
        for (const item of effectivenessItems) {
          const rule = findRule(item.ruleId);
          const ruleText = rule ? truncate(rule.text) : `[${item.ruleId}]`;
          const icon = item.level === 'LOW' ? pc.red('⚠') : pc.yellow('⚠');
          const levelLabel = item.level === 'LOW' ? pc.red(item.level.padEnd(6)) : pc.yellow(item.level.padEnd(6));
          lines.push(`  ${icon} ${levelLabel}  "${ruleText}"`);
          lines.push(`           ${item.reason}`);
          // Only show rewrites for LOW effectiveness rules
          if (item.level === 'LOW' && item.suggestedRewrite) {
            lines.push(`           ${pc.cyan('Rewrite:')} "${item.suggestedRewrite}"`);
          }
        }
      }

      // COVERAGE GAPS
      if (result.deepAnalysis.coverageGaps.length > 0) {
        lines.push('');
        lines.push(pc.bold('COVERAGE GAPS'));
        for (const gap of result.deepAnalysis.coverageGaps) {
          lines.push(`  ${pc.red('✗')} ${pc.red('MISSING')}  ${pc.bold(gap.area)}`);
          lines.push(`           ${gap.description}`);
          if (gap.evidence) {
            lines.push(`           ${pc.dim(gap.evidence)}`);
          }
        }
      }

      // CONSOLIDATION
      if (result.deepAnalysis.consolidation.length > 0) {
        lines.push('');
        lines.push(pc.bold('CONSOLIDATION'));
        for (const item of result.deepAnalysis.consolidation) {
          // Resolve rule IDs to text for display
          const ruleTexts = item.ruleIds
            .map((id) => findRule(id))
            .filter(Boolean)
            .map((r) => `"${truncate(r!.text, 40)}"`);
          const ruleLabel = ruleTexts.length > 0 ? ruleTexts.join(' + ') : item.ruleIds.join(', ');
          lines.push(`  ${pc.yellow('⚠')} ${pc.yellow('MERGE')}   ${ruleLabel}`);
          lines.push(`           Saves ~${item.tokenSavings} tokens. Merged:`);
          lines.push(`           "${item.mergedText}"`);
        }
      }
    }

    return lines.join('\n');
  }
}
