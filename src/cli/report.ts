import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import type { Command } from 'commander';
import { ANALYSIS_VERSION } from '../history/analysis-version.js';
import { discoverInstructionFiles } from '../parsers/auto-detect.js';
import { loadInstructionGraph } from '../parsers/instruction-loader.js';
import { HistoryStore } from '../history/store.js';
import type { SessionResult } from '../history/types.js';
import type { Rule } from '../parsers/types.js';

export type TrendCategory = 'IMPROVED' | 'DEGRADED' | 'STABLE' | 'NEW';

export interface RuleTrend {
  rule: Rule;
  totalRelevant: number;
  totalFollowed: number;
  adherenceFirstHalf: number | null;
  adherenceSecondHalf: number | null;
  overallAdherence: number | null;
  category: TrendCategory;
}

export interface Recommendation {
  ruleText: string;
  reason: string;
}

export interface ReportData {
  days: number;
  totalSessions: number;
  overallFirst: number;
  overallSecond: number;
  trends: RuleTrend[];
  recommendations: Recommendation[];
}

/**
 * Compute adherence for a rule across a set of sessions.
 */
function ruleAdherenceInSessions(
  ruleId: string,
  sessions: SessionResult[],
): { relevant: number; followed: number } {
  let relevant = 0;
  let followed = 0;
  for (const session of sessions) {
    for (const obs of session.observations) {
      if (obs.ruleId === ruleId && obs.relevant) {
        relevant++;
        if (obs.followed === true) followed++;
      }
    }
  }
  return { relevant, followed };
}

/**
 * Compute the full report data from rules and sessions.
 */
export function computeReport(
  rules: Rule[],
  sessions: SessionResult[],
  days: number,
): ReportData {
  const now = Date.now();
  const windowMs = days * 24 * 60 * 60 * 1000;
  const cutoff = now - windowMs;

  // Filter sessions within window
  const filtered = sessions.filter(
    (s) => new Date(s.timestamp).getTime() >= cutoff,
  );

  if (filtered.length === 0) {
    return {
      days,
      totalSessions: 0,
      overallFirst: 0,
      overallSecond: 0,
      trends: [],
      recommendations: [],
    };
  }

  // Sort by timestamp
  filtered.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  // Split into halves
  const mid = Math.floor(filtered.length / 2);
  const firstHalf = filtered.slice(0, Math.max(mid, 1));
  const secondHalf = filtered.slice(Math.max(mid, 1));

  // Compute overall adherence for each half
  function overallAdherence(sess: SessionResult[]): number {
    let rel = 0;
    let fol = 0;
    for (const s of sess) {
      for (const obs of s.observations) {
        if (obs.relevant) {
          rel++;
          if (obs.followed === true) fol++;
        }
      }
    }
    return rel > 0 ? Math.round((fol / rel) * 100) : 0;
  }

  const overallFirst = overallAdherence(firstHalf);
  const overallSecond = overallAdherence(secondHalf);

  // Compute per-rule trends
  const trends: RuleTrend[] = [];
  for (const rule of rules) {
    const full = ruleAdherenceInSessions(rule.id, filtered);
    const first = ruleAdherenceInSessions(rule.id, firstHalf);
    const second = ruleAdherenceInSessions(rule.id, secondHalf);

    const adherenceFirst =
      first.relevant > 0 ? Math.round((first.followed / first.relevant) * 100) : null;
    const adherenceSecond =
      second.relevant > 0 ? Math.round((second.followed / second.relevant) * 100) : null;
    const overallAdh =
      full.relevant > 0 ? Math.round((full.followed / full.relevant) * 100) : null;

    let category: TrendCategory;
    if (adherenceFirst === null && adherenceSecond !== null) {
      category = 'NEW';
    } else if (adherenceFirst !== null && adherenceSecond !== null) {
      const diff = adherenceSecond - adherenceFirst;
      if (diff > 10) category = 'IMPROVED';
      else if (diff < -10) category = 'DEGRADED';
      else category = 'STABLE';
    } else {
      category = 'STABLE';
    }

    trends.push({
      rule,
      totalRelevant: full.relevant,
      totalFollowed: full.followed,
      adherenceFirstHalf: adherenceFirst,
      adherenceSecondHalf: adherenceSecond,
      overallAdherence: overallAdh,
      category,
    });
  }

  // Compute recommendations
  const recommendations: Recommendation[] = [];
  for (const trend of trends) {
    if (trend.overallAdherence !== null && trend.overallAdherence < 20) {
      recommendations.push({
        ruleText: trend.rule.text,
        reason: `has been below 20% for the reporting window. Consider rephrasing or removing.`,
      });
    }
  }

  const neverRelevant = trends.filter((t) => t.totalRelevant === 0);
  if (neverRelevant.length > 0) {
    const count = neverRelevant.length;
    const verb = count === 1 ? 'has' : 'have';
    recommendations.push({
      ruleText: `${count} rule${count === 1 ? '' : 's'}`,
      reason: `${verb} never been relevant in any session. May be too specific or irrelevant to current work.`,
    });
  }

  return {
    days,
    totalSessions: filtered.length,
    overallFirst,
    overallSecond,
    trends,
    recommendations,
  };
}

export function formatTerminalReport(data: ReportData): string {
  if (data.totalSessions === 0) {
    return 'No history found within the reporting window. Run `alignkit check` first.';
  }

  const lines: string[] = [];

  lines.push(
    pc.bold(
      `ADHERENCE REPORT \u2014 last ${data.days} days (${data.totalSessions} session${data.totalSessions === 1 ? '' : 's'})`,
    ),
  );
  lines.push('');

  // Only show trend line when we have enough data to split meaningfully
  if (data.totalSessions >= 2) {
    const diff = data.overallSecond - data.overallFirst;
    const diffStr = diff >= 0 ? `+${diff}%` : `${diff}%`;
    lines.push(`Overall: ${data.overallFirst}% \u2192 ${data.overallSecond}% (${diffStr})`);
  } else {
    // Single session — show overall only, no trend
    const overall = data.overallFirst || data.overallSecond;
    lines.push(`Overall: ${overall}%`);
    lines.push(pc.dim('(Not enough sessions for trend analysis — need at least 2)'));
  }
  lines.push('');

  const improved = data.trends.filter((t) => t.category === 'IMPROVED');
  const degraded = data.trends.filter((t) => t.category === 'DEGRADED');
  const stable = data.trends.filter((t) => t.category === 'STABLE');
  const newRules = data.trends.filter((t) => t.category === 'NEW');

  if (improved.length > 0) {
    lines.push(pc.green('IMPROVED:'));
    for (const t of improved) {
      const text = truncateRule(t.rule.text, 40);
      lines.push(
        `  \u2713 "${text}"${padTo(text, 42)}${t.adherenceFirstHalf ?? '-'}% \u2192 ${t.adherenceSecondHalf ?? '-'}%`,
      );
    }
    lines.push('');
  }

  if (degraded.length > 0) {
    lines.push(pc.red('DEGRADED:'));
    for (const t of degraded) {
      const text = truncateRule(t.rule.text, 40);
      const suffix =
        t.overallAdherence !== null && t.overallAdherence < 20
          ? '  (consistently violated)'
          : '';
      lines.push(
        `  \u2717 "${text}"${padTo(text, 42)}${t.adherenceFirstHalf ?? '-'}% \u2192 ${t.adherenceSecondHalf ?? '-'}%${suffix}`,
      );
    }
    lines.push('');
  }

  if (stable.length > 0) {
    lines.push('STABLE:');
    for (const t of stable) {
      const text = truncateRule(t.rule.text, 40);
      lines.push(
        `  ~ "${text}"${padTo(text, 42)}${t.adherenceFirstHalf ?? '-'}% \u2192 ${t.adherenceSecondHalf ?? '-'}%`,
      );
    }
    lines.push('');
  }

  if (newRules.length > 0) {
    lines.push(pc.cyan('NEW:'));
    for (const t of newRules) {
      const text = truncateRule(t.rule.text, 40);
      lines.push(`  + "${text}"${padTo(text, 42)}${t.adherenceSecondHalf ?? '-'}%`);
    }
    lines.push('');
  }

  if (data.recommendations.length > 0) {
    lines.push(pc.yellow('RECOMMENDATIONS:'));
    for (const rec of data.recommendations) {
      // Don't quote numeric summaries like "5 rules"
      const isCount = /^\d+ rules?$/.test(rec.ruleText);
      const display = isCount ? rec.ruleText : `"${rec.ruleText}"`;
      lines.push(`  \u2022 ${display} ${rec.reason}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatJsonReport(data: ReportData): string {
  return JSON.stringify(data, null, 2);
}

export function formatMarkdownReport(data: ReportData): string {
  if (data.totalSessions === 0) {
    return 'No history found within the reporting window.';
  }

  const lines: string[] = [];
  const diff = data.overallSecond - data.overallFirst;
  const diffStr = diff >= 0 ? `+${diff}%` : `${diff}%`;

  lines.push(`# Adherence Report — last ${data.days} days`);
  lines.push('');
  lines.push(`**Sessions:** ${data.totalSessions}`);
  lines.push(`**Overall:** ${data.overallFirst}% → ${data.overallSecond}% (${diffStr})`);
  lines.push('');
  lines.push('| Rule | Category | First Half | Second Half |');
  lines.push('|------|----------|------------|-------------|');

  for (const t of data.trends) {
    const text =
      t.rule.text.length > 50 ? t.rule.text.slice(0, 49) + '...' : t.rule.text;
    lines.push(
      `| ${text} | ${t.category} | ${t.adherenceFirstHalf ?? '-'}% | ${t.adherenceSecondHalf ?? '-'}% |`,
    );
  }

  return lines.join('\n');
}

export function formatHtmlReport(data: ReportData): string {
  const diff = data.overallSecond - data.overallFirst;
  const diffStr = diff >= 0 ? `+${diff}%` : `${diff}%`;

  const rows = data.trends
    .map((t) => {
      const adh = t.overallAdherence ?? 0;
      const barColor =
        adh >= 80 ? '#4caf50' : adh >= 50 ? '#ff9800' : '#f44336';
      return `<tr>
        <td>${escapeHtml(t.rule.text)}</td>
        <td><span class="badge ${t.category.toLowerCase()}">${t.category}</span></td>
        <td>${t.adherenceFirstHalf ?? '-'}%</td>
        <td>${t.adherenceSecondHalf ?? '-'}%</td>
        <td>
          <div class="bar-bg"><div class="bar" style="width:${adh}%;background:${barColor}"></div></div>
          ${adh}%
        </td>
      </tr>`;
    })
    .join('\n');

  const recItems = data.recommendations
    .map((r) => `<li><strong>"${escapeHtml(r.ruleText)}"</strong> ${escapeHtml(r.reason)}</li>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>alignkit Adherence Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #333; }
  h1 { border-bottom: 2px solid #eee; padding-bottom: .5rem; }
  .summary { font-size: 1.2rem; margin: 1rem 0; }
  table { width: 100%; border-collapse: collapse; margin: 1rem 0; }
  th, td { text-align: left; padding: .5rem; border-bottom: 1px solid #eee; }
  th { background: #f9f9f9; }
  .bar-bg { display: inline-block; width: 100px; height: 14px; background: #eee; border-radius: 3px; vertical-align: middle; margin-right: .5rem; }
  .bar { height: 100%; border-radius: 3px; }
  .badge { padding: 2px 8px; border-radius: 3px; font-size: .8rem; font-weight: bold; }
  .improved { background: #e8f5e9; color: #2e7d32; }
  .degraded { background: #fbe9e7; color: #c62828; }
  .stable { background: #f5f5f5; color: #616161; }
  .new { background: #e3f2fd; color: #1565c0; }
  ul { line-height: 1.8; }
</style>
</head>
<body>
<h1>alignkit Adherence Report</h1>
<p class="summary">Last ${data.days} days &mdash; ${data.totalSessions} sessions<br>
Overall: ${data.overallFirst}% &rarr; ${data.overallSecond}% (${diffStr})</p>
<table>
<thead><tr><th>Rule</th><th>Trend</th><th>First Half</th><th>Second Half</th><th>Overall</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
${data.recommendations.length > 0 ? `<h2>Recommendations</h2><ul>${recItems}</ul>` : ''}
</body>
</html>`;
}

function truncateRule(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '\u2026' : text;
}

function padTo(text: string, width: number): string {
  const len = text.length + 2; // account for quotes
  return len < width ? ' '.repeat(width - len) : ' ';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function registerReportCommand(program: Command): void {
  program
    .command('report [file]')
    .description('Trend analysis with recommendations')
    .option('--days <n>', 'Reporting window in days', '7')
    .option('--format <format>', 'Output format: terminal, json, markdown, html', 'terminal')
    .action(async (file: string | undefined, options: { days: string; format: string }) => {
      const cwd = process.cwd();
      const days = parseInt(options.days, 10);

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
      const rules = loadInstructionGraph(filePath).rules;

      // 3. Load history
      const alignkitDir = path.join(cwd, '.alignkit');
      const store = new HistoryStore(alignkitDir);
      const rulesVersion = HistoryStore.computeRulesVersion(filePath);
      const sessions = store.queryByEpoch(rulesVersion, ANALYSIS_VERSION);

      // 4. Compute report
      const data = computeReport(rules, sessions, days);

      if (data.totalSessions === 0) {
        console.log('No history found within the reporting window. Run `alignkit check` first.');
        return;
      }

      // 5. Output
      switch (options.format) {
        case 'json':
          console.log(formatJsonReport(data));
          break;
        case 'markdown':
          console.log(formatMarkdownReport(data));
          break;
        case 'html': {
          if (!existsSync(alignkitDir)) {
            mkdirSync(alignkitDir, { recursive: true });
          }
          const htmlPath = path.join(alignkitDir, 'report.html');
          writeFileSync(htmlPath, formatHtmlReport(data), 'utf-8');
          console.log(`HTML report written to ${htmlPath}`);
          break;
        }
        default:
          console.log(formatTerminalReport(data));
          break;
      }
    });
}
