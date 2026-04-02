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

    // Compute diagnostic counts (used by both views and NEXT STEPS)
    const DEEP_CODES = new Set<string>(['EFFECTIVENESS', 'REWRITE', 'COVERAGE_GAP', 'CONSOLIDATION']);
    const allDiags = result.rules.flatMap((r) => r.diagnostics).filter((d) => !DEEP_CODES.has(d.code));
    const vague = allDiags.filter((d) => d.code === 'VAGUE').length;
    const conflicting = allDiags.filter((d) => d.code === 'CONFLICT').length;
    const redundant = allDiags.filter((d) => d.code === 'REDUNDANT').length;
    const linterJob = allDiags.filter((d) => d.code === 'LINTER_JOB').length;
    const placement = allDiags.filter((d) => d.code === 'PLACEMENT').length;
    const weakEmphasis = allDiags.filter((d) => d.code === 'WEAK_EMPHASIS').length;
    const auto = result.rules.filter((r: Rule) => autoMap(r) !== null).length;

    if (result.deepAnalysis) {
      // ── DEEP MODE: unified view, no separate static diagnostics ──
      const findRule = (idPrefix: string): Rule | undefined =>
        result.rules.find((r: Rule) => r.id.startsWith(idPrefix));

      const effectivenessItems = result.deepAnalysis.effectiveness.filter(
        (e) => e.level !== 'HIGH'
      );
      const gapCount = result.deepAnalysis.coverageGaps.length;
      const mergeCount = result.deepAnalysis.consolidation.length;

      // Scorecard — one line combining static + deep findings
      const scoreParts: string[] = [];
      if (effectivenessItems.length > 0) scoreParts.push(`${effectivenessItems.length} weak`);
      if (gapCount > 0) scoreParts.push(`${gapCount} gaps`);
      if (mergeCount > 0) scoreParts.push(`${mergeCount} mergeable`);
      if (conflicting > 0) scoreParts.push(`${conflicting} conflicting`);
      if (placement > 0) scoreParts.push(`${placement} misplaced`);
      if (linterJob > 0) scoreParts.push(`${linterJob} linter-job`);
      if (scoreParts.length > 0) {
        lines.push(pc.dim(`  ${scoreParts.join(' · ')}`));
        lines.push('');
      }

      // EFFECTIVENESS
      if (effectivenessItems.length > 0) {
        lines.push(pc.bold('  Effectiveness'));
        for (const item of effectivenessItems) {
          const rule = findRule(item.ruleId);
          const ruleText = rule ? truncate(rule.text, 45) : `[${item.ruleId}]`;
          const levelColor = item.level === 'LOW' ? pc.red : pc.yellow;
          lines.push(`  ${levelColor(item.level.padEnd(7))} ${pc.dim('"' + ruleText + '"')}`);
          lines.push(`          ${item.reason}`);
          if (item.level === 'LOW' && item.suggestedRewrite) {
            lines.push(`          ${pc.cyan('→')} "${item.suggestedRewrite}"`);
          }
        }
        lines.push('');
      }

      // COVERAGE GAPS
      if (gapCount > 0) {
        const MAX_GAPS = 3;
        const gaps = result.deepAnalysis.coverageGaps;
        lines.push(pc.bold('  Coverage Gaps'));
        for (const gap of gaps.slice(0, MAX_GAPS)) {
          lines.push(`  ${pc.red('✗')} ${pc.bold(gap.area)} — ${gap.description}`);
          if (gap.suggestedRule) {
            lines.push(`    ${pc.cyan('+')} ${gap.suggestedRule}`);
          }
        }
        if (gapCount > MAX_GAPS) {
          lines.push(pc.dim(`  + ${gapCount - MAX_GAPS} more — run ${pc.cyan('alignkit lint --deep --format markdown')} for full report`));
        }
        lines.push('');
      }

      // CONSOLIDATION
      if (mergeCount > 0) {
        lines.push(pc.bold('  Consolidation'));
        for (const item of result.deepAnalysis.consolidation) {
          const ruleTexts = item.ruleIds
            .map((id) => findRule(id))
            .filter(Boolean)
            .map((r) => truncate(r!.text, 30));
          const ruleLabel = ruleTexts.length > 0
            ? ruleTexts.map((t) => pc.dim('"' + t + '"')).join(' + ')
            : item.ruleIds.join(', ');
          lines.push(`  ${pc.yellow('→')} Merge ${ruleLabel}`);
          lines.push(`    Saves ~${item.tokenSavings} tokens → "${truncate(item.mergedText, 80)}"`);
        }
        lines.push('');
      }
    } else {
      // ── STATIC MODE: show grouped diagnostics ──
      const fileDiagnostics = result.fileDiagnostics.map((d) => ({ d }));
      const staticDiagnostics = result.rules.flatMap((rule) =>
        rule.diagnostics
          .filter((d) => !DEEP_CODES.has(d.code))
          .map((d) => ({ rule, d }))
      );

      if (fileDiagnostics.length > 0 || staticDiagnostics.length > 0) {
        for (const { d } of fileDiagnostics) {
          const icon = d.severity === 'error' ? pc.red('✗') : pc.yellow('⚠');
          const code = d.severity === 'error' ? pc.red(d.code) : pc.yellow(d.code);
          lines.push(`  ${icon} ${code}  ${pc.dim('(file)')}`);
          lines.push(`     ${d.message}`);
        }

        const grouped = new Map<string, typeof staticDiagnostics>();
        for (const entry of staticDiagnostics) {
          const key = entry.d.code;
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(entry);
        }

        for (const [_code, entries] of grouped) {
          if (entries.length <= 2) {
            for (const { rule, d } of entries) {
              const icon = d.severity === 'error' ? pc.red('✗') : pc.yellow('⚠');
              const code = d.severity === 'error' ? pc.red(d.code) : pc.yellow(d.code);
              lines.push(`  ${icon} ${code}  ${pc.dim(truncate(rule.text))}`);
              lines.push(`     ${d.message}`);
            }
          } else {
            const first = entries[0];
            const icon = first.d.severity === 'error' ? pc.red('✗') : pc.yellow('⚠');
            const code = first.d.severity === 'error' ? pc.red(first.d.code) : pc.yellow(first.d.code);
            const count = entries.length;
            let summary: string;
            switch (first.d.code) {
              case 'PLACEMENT': {
                const targets = [...new Set(entries.map((e) => e.d.placement?.detail).filter(Boolean))];
                const targetStr = targets.length > 0 ? ` (${targets.slice(0, 3).join(', ')})` : '';
                summary = `${count} rules target specific paths${targetStr}. Move into path-scoped rules.`;
                break;
              }
              case 'ORDERING': summary = `${count} high-priority rules appear too late in the file. Move them to the top.`; break;
              case 'VAGUE': summary = `${count} rules are too vague to be actionable. Rewrite with specific, concrete language.`; break;
              case 'CONFLICT': summary = `${count} rules send contradictory signals. Resolve or remove the weaker rule.`; break;
              case 'REDUNDANT': summary = `${count} rules overlap significantly. Merge them to save tokens.`; break;
              case 'LINTER_JOB': summary = `${count} rules describe formatting/style. Move to linter config instead.`; break;
              case 'WEAK_EMPHASIS': summary = `${count} critical rules use weak language. Strengthen with MUST, NEVER, ALWAYS.`; break;
              default: summary = `${count} issues found.`;
            }
            lines.push(`  ${icon} ${code}  ${summary}`);
          }
        }
        lines.push('');
      }

      // HEALTH + TOKENS only in static mode (deep mode scorecard replaces these)
      const ruleCount = result.rules.length;
      const RULE_CEILING = 150;
      const ruleCountStr = ruleCount > RULE_CEILING
        ? pc.red(`${ruleCount} rules (recommended: under ${RULE_CEILING})`)
        : `${ruleCount} rules`;
      const pathScoped = result.rules.filter((r) => r.applicability?.kind === 'path-scoped').length;

      let healthParts = [ruleCountStr, `${auto} auto-verifiable`];
      if (vague > 0) healthParts.push(`${vague} vague`);
      if (conflicting > 0) healthParts.push(`${conflicting} conflicting`);
      if (redundant > 0) healthParts.push(`${redundant} redundant`);
      if (linterJob > 0) healthParts.push(`${linterJob} linter-job`);
      if (placement > 0) healthParts.push(`${placement} misplaced`);
      if (weakEmphasis > 0) healthParts.push(`${weakEmphasis} weak-emphasis`);
      if (pathScoped > 0) healthParts.push(`${pathScoped} path-scoped`);

      lines.push(`${pc.bold('HEALTH')}  ${healthParts.join(', ')}`);

      const pct = result.tokenAnalysis.contextWindowPercent.toFixed(1);
      const budget = formatNumber(result.tokenAnalysis.budgetThreshold);
      const tokenSummary = `~${tokenStr} (~${pct}% of effective context window). Recommended: under ${budget}.`;
      lines.push(
        `${pc.bold('TOKENS')}  ${result.tokenAnalysis.overBudget ? pc.red(tokenSummary) : tokenSummary}`
      );
    }

    // NEXT STEPS — single unified call to action at the bottom
    const nextSteps: string[] = [];

    // Compute counts needed for next steps
    const orderingIssues = result.rules.flatMap((r) => r.diagnostics).filter((d) => d.code === 'ORDERING').length;
    const redundantPairs = Math.floor(redundant / 2);
    const stale = result.rules.flatMap((r) => r.diagnostics).filter((d) => d.code === 'STALE').length;

    // Priority 1: Run optimize if there are ordering/redundancy/merge issues
    const optimizeParts: string[] = [];
    if (orderingIssues > 0) optimizeParts.push('fix ordering');
    if (redundantPairs > 0) optimizeParts.push(`merge ${redundantPairs} duplicate pair${redundantPairs > 1 ? 's' : ''}`);
    if (result.deepAnalysis && result.deepAnalysis.consolidation.length > 0) {
      const totalSaved = result.deepAnalysis.consolidation.reduce((sum, c) => sum + c.tokenSavings, 0);
      optimizeParts.push(`consolidate rules (saves ~${totalSaved} tokens)`);
    }
    if (optimizeParts.length > 0) {
      nextSteps.push(`Run ${pc.cyan('alignkit optimize')} to ${optimizeParts.join(', ')}`);
    }

    // Priority 2: Coverage gaps — name the areas to add rules for
    if (result.deepAnalysis && result.deepAnalysis.coverageGaps.length > 0) {
      const gaps = result.deepAnalysis.coverageGaps;
      const hasSuggestions = gaps.some((g) => g.suggestedRule);
      if (hasSuggestions) {
        nextSteps.push(`Add ${gaps.length} suggested rule${gaps.length > 1 ? 's' : ''} from coverage gaps above`);
      } else {
        const gapNames = gaps.slice(0, 3).map((g) => g.area);
        const more = gaps.length > 3 ? ` + ${gaps.length - 3} more` : '';
        nextSteps.push(`Add rules for: ${gapNames.join(', ')}${more}`);
      }
    }

    // Placement moves are flagged in diagnostics above — not repeated here
    // since they require manual restructuring, not a single command

    // Priority 4: Weak rules need rewriting
    const weakCount = result.deepAnalysis
      ? result.deepAnalysis.effectiveness.filter((e) => e.level === 'LOW').length
      : 0;
    if (weakCount > 0) {
      nextSteps.push(`Rewrite ${weakCount} weak rule${weakCount > 1 ? 's' : ''} — see suggestions above`);
    } else if (vague > 0 && !result.deepAnalysis) {
      nextSteps.push(`Rewrite ${vague} vague rule${vague > 1 ? 's' : ''} → run ${pc.cyan('alignkit lint --deep')} for suggestions`);
    }

    // Priority 5: Other static issues
    if (linterJob > 0) {
      nextSteps.push(`Move ${linterJob} formatting rule${linterJob > 1 ? 's' : ''} to linter config`);
    }
    if (stale > 0) {
      nextSteps.push(`Verify ${stale} version reference${stale > 1 ? 's are' : ' is'} current`);
    }
    if (weakEmphasis > 0) {
      nextSteps.push(`Strengthen ${weakEmphasis} critical rule${weakEmphasis > 1 ? 's' : ''} with MUST/NEVER/ALWAYS`);
    }

    if (nextSteps.length > 0) {
      lines.push('');
      lines.push(pc.bold('NEXT STEPS'));
      for (let i = 0; i < Math.min(nextSteps.length, 4); i++) {
        lines.push(`  ${pc.cyan(`${i + 1}.`)} ${nextSteps[i]}`);
      }
    }

    return lines.join('\n');
  }
}
