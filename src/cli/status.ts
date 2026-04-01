import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { ANALYSIS_VERSION } from '../history/analysis-version.js';
import { discoverInstructionFiles } from '../parsers/auto-detect.js';
import { HistoryStore } from '../history/store.js';
import type { SessionResult } from '../history/types.js';

const SPARKLINE_CHARS = '\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588';

/**
 * Generate a sparkline string from an array of values between 0 and 1.
 */
export function sparkline(values: number[]): string {
  if (values.length === 0) return '';
  const max = Math.max(...values, 0.001); // avoid division by zero
  return values
    .map((v) => {
      const idx = Math.min(Math.round((v / max) * 7), 7);
      return SPARKLINE_CHARS[idx];
    })
    .join('');
}

/**
 * Compute per-session adherence rate (followed/relevant).
 */
export function sessionAdherence(result: SessionResult): number {
  const relevant = result.observations.filter((o) => o.relevant);
  if (relevant.length === 0) return 1;
  const followed = relevant.filter((o) => o.followed === true).length;
  return followed / relevant.length;
}

/**
 * Determine trend by comparing first half vs second half average adherence.
 */
export function computeTrend(rates: number[]): string {
  if (rates.length < 2) return 'stable';
  const mid = Math.floor(rates.length / 2);
  const firstHalf = rates.slice(0, mid);
  const secondHalf = rates.slice(mid);
  const avg = (arr: number[]): number => arr.reduce((a, b) => a + b, 0) / arr.length;
  const diff = avg(secondHalf) - avg(firstHalf);
  if (diff > 0.05) return 'trending up';
  if (diff < -0.05) return 'trending down';
  return 'stable';
}

/**
 * Format a duration in days from earliest to latest session.
 */
function formatDuration(sessions: SessionResult[]): string {
  if (sessions.length === 0) return '';
  const timestamps = sessions.map((s) => new Date(s.timestamp).getTime());
  const earliest = Math.min(...timestamps);
  const latest = Math.max(...timestamps);
  const days = Math.max(1, Math.ceil((latest - earliest) / (1000 * 60 * 60 * 24)));
  return `last ${days} day${days === 1 ? '' : 's'}`;
}

/**
 * Compute status output from history sessions.
 */
export function computeStatus(
  fileName: string,
  sessions: SessionResult[],
): string {
  if (sessions.length === 0) {
    return 'No history found. Run `alignkit check` first to analyze your sessions, or `alignkit watch` to build history over time.';
  }

  // Overall adherence
  let totalRelevant = 0;
  let totalFollowed = 0;
  for (const session of sessions) {
    for (const obs of session.observations) {
      if (obs.relevant) {
        totalRelevant++;
        if (obs.followed === true) totalFollowed++;
      }
    }
  }
  const overallPct = totalRelevant > 0 ? Math.round((totalFollowed / totalRelevant) * 100) : 0;

  // Per-session adherence for sparkline (last 10)
  const perSession = sessions.map(sessionAdherence);
  const last10 = perSession.slice(-10);
  const spark = sparkline(last10);
  const trend = computeTrend(last10);
  const duration = formatDuration(sessions);

  // Rule statistics
  const ruleStats = new Map<string, { relevant: number; followed: number; firstSeen: number }>();
  for (let i = 0; i < sessions.length; i++) {
    for (const obs of sessions[i].observations) {
      if (!ruleStats.has(obs.ruleId)) {
        ruleStats.set(obs.ruleId, { relevant: 0, followed: 0, firstSeen: i });
      }
      const stat = ruleStats.get(obs.ruleId)!;
      if (obs.relevant) {
        stat.relevant++;
        if (obs.followed === true) stat.followed++;
      }
    }
  }

  const totalRules = ruleStats.size;
  let fullyFollowed = 0;
  let consistentlyViolated = 0;
  let newRules = 0;

  for (const [, stat] of ruleStats) {
    if (stat.relevant > 0 && stat.followed === stat.relevant) {
      fullyFollowed++;
    }
    if (stat.relevant > 0 && stat.followed / stat.relevant < 0.2) {
      consistentlyViolated++;
    }
    if (stat.firstSeen >= sessions.length - 3) {
      newRules++;
    }
  }

  const line1 = `${fileName}  ${overallPct}% adherence across ${sessions.length} sessions (${duration})  ${spark} ${trend}`;
  const line2 = `  ${totalRules} rules tracked \u00B7 ${fullyFollowed} fully followed \u00B7 ${consistentlyViolated} consistently violated \u00B7 ${newRules} new`;

  return `${line1}\n${line2}`;
}

export function registerStatusCommand(program: Command): void {
  program
    .command('status [file]')
    .description('Quick pulse check of rule adherence from history')
    .action(async (file: string | undefined) => {
      const cwd = process.cwd();

      // 1. Auto-discover instruction file
      let filePath: string;
      let fileName: string;

      if (file) {
        filePath = path.resolve(cwd, file);
        fileName = path.basename(filePath);
      } else {
        const discovered = discoverInstructionFiles(cwd);
        if (discovered.length === 0) {
          console.error('Error: No instruction files found.');
          process.exit(1);
        }
        filePath = discovered[0].absolutePath;
        fileName = discovered[0].relativePath;
      }

      // 2. Load history store
      const alignkitDir = path.join(cwd, '.alignkit');
      const store = new HistoryStore(alignkitDir);

      // 3. Get current epoch sessions
      const rulesVersion = HistoryStore.computeRulesVersion(filePath);
      const sessions = store.queryByEpoch(rulesVersion, ANALYSIS_VERSION);

      // 4. Output status
      console.log(computeStatus(fileName, sessions));
    });
}
