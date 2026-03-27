import type { LintResult } from '../analyzers/types.js';
import type { Reporter } from './types.js';

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

    return lines.join('\n');
  }
}
