import type { LintResult } from '../analyzers/types.js';
import type { Reporter } from './types.js';
import type { Rule } from '../parsers/types.js';

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

export class MarkdownReporter implements Reporter {
  report(result: LintResult): string {
    const lines: string[] = [];

    // Heading
    lines.push(`# ${result.file}`);
    lines.push('');

    // Stats line
    const tokenStr = formatNumber(result.tokenAnalysis.tokenCount);
    lines.push(`**${result.rules.length} rules**, ~${tokenStr} tokens`);
    lines.push('');

    if (result.fileDiagnostics.length > 0) {
      lines.push('## File Diagnostics');
      lines.push('');
      lines.push('| Severity | Code | Scope | Message |');
      lines.push('|----------|------|-------|---------|');
      for (const diagnostic of result.fileDiagnostics) {
        const severity = diagnostic.severity === 'error' ? 'Error' : 'Warning';
        const message = diagnostic.message.replace(/\|/g, '\\|');
        lines.push(`| ${severity} | ${diagnostic.code} | (file) | ${message} |`);
      }
      lines.push('');
    }

    // Diagnostics table if any
    const allDiagnostics = result.rules.flatMap((rule) =>
      rule.diagnostics.map((d) => ({ rule, d }))
    );

    if (allDiagnostics.length > 0) {
      lines.push('## Diagnostics');
      lines.push('');
      lines.push('| Severity | Code | Rule | Message |');
      lines.push('|----------|------|------|---------|');
      for (const { rule, d } of allDiagnostics) {
        const severity = d.severity === 'error' ? 'Error' : 'Warning';
        const ruleText = rule.text.replace(/\|/g, '\\|');
        const message = d.message.replace(/\|/g, '\\|');
        lines.push(`| ${severity} | ${d.code} | ${ruleText} | ${message} |`);
      }
      lines.push('');
    }

    // Deep analysis sections
    if (result.deepAnalysis) {
      const ruleMap = new Map(result.rules.map((r: Rule) => [r.id, r]));

      // Effectiveness Predictions — skip HIGH
      const effectivenessItems = result.deepAnalysis.effectiveness.filter(
        (e) => e.level !== 'HIGH'
      );
      if (effectivenessItems.length > 0) {
        lines.push('## Effectiveness Predictions');
        lines.push('');
        lines.push('| Level | Rule | Reason | Suggested Rewrite |');
        lines.push('|-------|------|--------|-------------------|');
        for (const item of effectivenessItems) {
          const rule = ruleMap.get(item.ruleId);
          const ruleText = (rule ? rule.text : item.ruleId).replace(/\|/g, '\\|');
          const reason = item.reason.replace(/\|/g, '\\|');
          const rewrite = item.suggestedRewrite ? item.suggestedRewrite.replace(/\|/g, '\\|') : '—';
          lines.push(`| ${item.level} | ${ruleText} | ${reason} | ${rewrite} |`);
        }
        lines.push('');
      }

      // Coverage Gaps
      if (result.deepAnalysis.coverageGaps.length > 0) {
        lines.push('## Coverage Gaps');
        lines.push('');
        lines.push('| Area | Description | Evidence |');
        lines.push('|------|-------------|----------|');
        for (const gap of result.deepAnalysis.coverageGaps) {
          const area = gap.area.replace(/\|/g, '\\|');
          const description = gap.description.replace(/\|/g, '\\|');
          const evidence = gap.evidence.replace(/\|/g, '\\|');
          lines.push(`| ${area} | ${description} | ${evidence} |`);
        }
        lines.push('');
      }

      // Consolidation
      if (result.deepAnalysis.consolidation.length > 0) {
        lines.push('## Consolidation Opportunities');
        lines.push('');
        for (const item of result.deepAnalysis.consolidation) {
          lines.push(`### Merge rules: ${item.ruleIds.join(', ')}`);
          lines.push('');
          lines.push(`**Token savings:** ~${item.tokenSavings}`);
          lines.push('');
          lines.push('**Merged rule:**');
          lines.push('');
          lines.push(`> ${item.mergedText}`);
          lines.push('');
        }
      }
    }

    return lines.join('\n');
  }
}
