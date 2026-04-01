import path from 'node:path';
import { ANALYSIS_VERSION } from '../../history/analysis-version.js';
import { discoverInstructionTargets } from '../../parsers/auto-detect.js';
import { HistoryStore } from '../../history/store.js';
import type { SessionResult } from '../../history/types.js';

export interface StatusToolResult {
  file: string;
  adherence: number;
  sessionCount: number;
  trend: 'up' | 'down' | 'stable' | 'insufficient';
  rules: { total: number; fullyFollowed: number; violated: number; new: number };
}

function sessionAdherence(result: SessionResult): number {
  const relevant = result.observations.filter((o) => o.relevant);
  if (relevant.length === 0) return 1;
  const followed = relevant.filter((o) => o.followed === true).length;
  return followed / relevant.length;
}

function computeTrend(rates: number[]): StatusToolResult['trend'] {
  if (rates.length < 2) return 'insufficient';
  const mid = Math.floor(rates.length / 2);
  const firstHalf = rates.slice(0, mid);
  const secondHalf = rates.slice(mid);
  const avg = (arr: number[]): number => arr.reduce((a, b) => a + b, 0) / arr.length;
  const diff = avg(secondHalf) - avg(firstHalf);
  if (diff > 0.05) return 'up';
  if (diff < -0.05) return 'down';
  return 'stable';
}

export function statusTool(cwd: string, file?: string): StatusToolResult {
  // 1. Resolve the target file
  let filePath: string;
  let relPath: string;

  if (file) {
    filePath = path.resolve(cwd, file);
    relPath = path.relative(cwd, filePath);
  } else {
    const discovered = discoverInstructionTargets(cwd);
    if (discovered.length === 0) {
      return {
        file: '(none)',
        adherence: 0,
        sessionCount: 0,
        trend: 'insufficient',
        rules: { total: 0, fullyFollowed: 0, violated: 0, new: 0 },
      };
    }
    filePath = discovered[0].absolutePath;
    relPath = discovered[0].relativePath;
  }

  // 2. Load history store
  const alignkitDir = path.join(cwd, '.alignkit');
  const store = new HistoryStore(alignkitDir);

  // 3. Get current epoch sessions
  const rulesVersion = HistoryStore.computeRulesVersion(filePath, cwd);
  const sessions = store.queryByEpoch(rulesVersion, ANALYSIS_VERSION);

  if (sessions.length === 0) {
    return {
      file: relPath,
      adherence: 0,
      sessionCount: 0,
      trend: 'insufficient',
      rules: { total: 0, fullyFollowed: 0, violated: 0, new: 0 },
    };
  }

  // 4. Compute overall adherence
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
  const adherence = totalRelevant > 0 ? totalFollowed / totalRelevant : 0;

  // 5. Compute trend
  const perSession = sessions.map(sessionAdherence);
  const last10 = perSession.slice(-10);
  const trend = computeTrend(last10);

  // 6. Rule statistics
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
  let violated = 0;
  let newRules = 0;

  for (const [, stat] of ruleStats) {
    if (stat.relevant > 0 && stat.followed === stat.relevant) {
      fullyFollowed++;
    }
    if (stat.relevant > 0 && stat.followed / stat.relevant < 0.2) {
      violated++;
    }
    if (stat.firstSeen >= sessions.length - 3) {
      newRules++;
    }
  }

  return {
    file: relPath,
    adherence: Math.round(adherence * 100),
    sessionCount: sessions.length,
    trend,
    rules: { total: totalRules, fullyFollowed, violated, new: newRules },
  };
}
