import pc from 'picocolors';
import type { LintResult } from '../analyzers/types.js';
import type { Reporter } from './types.js';
import type { Rule } from '../parsers/types.js';

const TRUNCATE_LEN = 60;

function truncate(text: string, len = TRUNCATE_LEN): string {
  return text.length > len ? text.slice(0, len - 1) + '…' : text;
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

    // Diagnostics section
    const allDiagnostics = result.rules.flatMap((rule) =>
      rule.diagnostics.map((d) => ({ rule, d }))
    );

    if (allDiagnostics.length > 0) {
      for (const { rule, d } of allDiagnostics) {
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
    const auto = result.rules.filter((r: Rule) => r.verifiability === 'auto').length;
    const vague = result.rules.flatMap((r) => r.diagnostics).filter((d) => d.code === 'VAGUE').length;
    const conflicting = result.rules.flatMap((r) => r.diagnostics).filter((d) => d.code === 'CONFLICT').length;
    const redundant = result.rules.flatMap((r) => r.diagnostics).filter((d) => d.code === 'REDUNDANT').length;

    // HEALTH summary
    let healthParts = [
      `${result.rules.length} rules`,
      `${auto} auto-verifiable`,
    ];
    if (vague > 0) healthParts.push(`${vague} vague`);
    if (conflicting > 0) healthParts.push(`${conflicting} conflicting`);
    if (redundant > 0) healthParts.push(`${redundant} redundant`);

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

    // Deep analysis sections
    if (result.deepAnalysis) {
      const ruleMap = new Map(result.rules.map((r: Rule) => [r.id, r]));

      // EFFECTIVENESS PREDICTIONS — skip HIGH, show MEDIUM and LOW
      const effectivenessItems = result.deepAnalysis.effectiveness.filter(
        (e) => e.level !== 'HIGH'
      );
      if (effectivenessItems.length > 0) {
        lines.push('');
        lines.push(pc.bold('EFFECTIVENESS PREDICTIONS'));
        for (const item of effectivenessItems) {
          const rule = ruleMap.get(item.ruleId);
          const ruleText = rule ? truncate(rule.text) : item.ruleId;
          const icon = item.level === 'LOW' ? pc.red('⚠') : pc.yellow('⚠');
          const levelLabel = item.level === 'LOW' ? pc.red(item.level.padEnd(6)) : pc.yellow(item.level.padEnd(6));
          lines.push(`  ${icon} ${levelLabel}  "${ruleText}"`);
          if (item.suggestedRewrite) {
            lines.push(`           ${item.reason}. Rewrite: "${item.suggestedRewrite}"`);
          } else {
            lines.push(`           ${item.reason}`);
          }
        }
      }

      // COVERAGE GAPS
      if (result.deepAnalysis.coverageGaps.length > 0) {
        lines.push('');
        lines.push(pc.bold('COVERAGE GAPS'));
        for (const gap of result.deepAnalysis.coverageGaps) {
          lines.push(`  ${pc.red('✗')} ${'MISSING'.padEnd(7)}  ${gap.area}`);
          lines.push(`           ${gap.description} (${gap.evidence})`);
        }
      }

      // CONSOLIDATION
      if (result.deepAnalysis.consolidation.length > 0) {
        lines.push('');
        lines.push(pc.bold('CONSOLIDATION'));
        for (const item of result.deepAnalysis.consolidation) {
          const ids = item.ruleIds.join(', ');
          lines.push(`  ${pc.yellow('⚠')} ${'MERGE'.padEnd(7)}  Rules ${ids} could merge (saves ~${item.tokenSavings} tokens)`);
          lines.push(`           "${truncate(item.mergedText)}"`);
        }
      }
    }

    return lines.join('\n');
  }
}
