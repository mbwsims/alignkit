import { statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { discoverInstructionTargets } from '../../parsers/auto-detect.js';
import { loadEffectiveInstructionGraph } from '../../parsers/instruction-loader.js';
import { readSessions } from '../../sessions/session-reader.js';
import { verifySession } from '../../verifiers/verifier-engine.js';
import { aggregateAdherence } from '../../check/adherence.js';
import { ANALYSIS_VERSION } from '../../history/analysis-version.js';
import { HistoryStore } from '../../history/store.js';
import { serializeObservation } from '../../verifiers/types.js';
import type { SessionResult } from '../../history/types.js';
import type { Rule } from '../../parsers/types.js';
import type { AgentAction } from '../../sessions/types.js';

export interface CheckToolResult {
  file: string;
  sessionCount: number;
  rules: Array<{
    text: string;
    relevantSessions: number;
    resolvedSessions: number;
    inconclusiveSessions: number;
    totalSessions: number;
    followed: number;
    adherence: number | null;
    method: string;
    confidence: string;
    confidenceReason: string;
    evidence?: string;
  }>;
  unresolvedRules: Array<{
    text: string;
    sessionActions: Array<{
      sessionId: string;
      bashCommands: string[];
      writtenFiles: string[];
      editedFiles: string[];
    }>;
  }>;
}

function getFileSince(filePath: string, cwd: string): Date {
  try {
    const result = execFileSync(
      'git',
      ['log', '-1', '--format=%cI', '--', filePath],
      { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    ).trim();

    if (result) {
      return new Date(result);
    }
  } catch {
    // Not a git repo or git not available
  }

  const stat = statSync(filePath);
  return new Date(stat.mtimeMs);
}

function getGraphSince(filePaths: string[], cwd: string): Date {
  return filePaths.reduce((latest, filePath) => {
    const candidate = getFileSince(filePath, cwd);
    return candidate.getTime() > latest.getTime() ? candidate : latest;
  }, new Date(0));
}

function summarizeActions(actions: AgentAction[]): {
  bashCommands: string[];
  writtenFiles: string[];
  editedFiles: string[];
} {
  const bashCommands: string[] = [];
  const writtenFiles: string[] = [];
  const editedFiles: string[] = [];

  for (const action of actions) {
    switch (action.type) {
      case 'bash':
        bashCommands.push(action.command);
        break;
      case 'write':
        writtenFiles.push(action.filePath);
        break;
      case 'edit':
        editedFiles.push(action.filePath);
        break;
    }
  }

  return { bashCommands, writtenFiles, editedFiles };
}

export function checkTool(cwd: string, file?: string, sinceDays?: number, sessionsDir?: string): CheckToolResult {
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
        sessionCount: 0,
        rules: [],
        unresolvedRules: [],
      };
    }
    filePath = discovered[0].absolutePath;
    relPath = discovered[0].relativePath;
  }

  // 2. Parse into rules
  const graph = loadEffectiveInstructionGraph(filePath, cwd);
  const rules = graph.rules;

  // 3. Compute rulesVersion hash
  const rulesVersion = graph.graphHash;

  // 4. Determine since date
  let sinceDate: Date;
  if (sinceDays !== undefined) {
    sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  } else {
    sinceDate = getGraphSince(graph.loadedFiles, cwd);
  }

  // 5. Read sessions
  const sessions = readSessions({ cwd, claudeDir: sessionsDir, since: sinceDate });

  // 6. Load history store and process new sessions
  const alignkitDir = path.join(cwd, '.alignkit');
  const store = new HistoryStore(alignkitDir);

  // Track session actions for unresolved rules
  const sessionActionsMap = new Map<string, { bashCommands: string[]; writtenFiles: string[]; editedFiles: string[] }>();

  for (const session of sessions) {
    sessionActionsMap.set(session.sessionId, summarizeActions(session.actions));

    if (store.hasSession(session.sessionId, rulesVersion, ANALYSIS_VERSION)) {
      continue;
    }

    const observations = verifySession(rules, session.actions, session.sessionId, cwd);

    const result: SessionResult = {
      sessionId: session.sessionId,
      timestamp: session.timestamp,
      rulesVersion,
      analysisVersion: ANALYSIS_VERSION,
      observations: observations.map(serializeObservation),
    };

    store.append(result);
  }

  // 7. Aggregate observations for current epoch
  const allResults = store.queryByEpoch(rulesVersion, ANALYSIS_VERSION);

  // 8. Build per-rule adherence
  const ruleResults = aggregateAdherence(rules, allResults).map((item) => ({
    text: item.rule.text,
    relevantSessions: item.relevantCount,
    resolvedSessions: item.resolvedCount,
    inconclusiveSessions: item.inconclusiveCount,
    totalSessions: item.totalSessions,
    followed: item.followedCount,
    adherence: item.adherence,
    method: item.method,
    confidence: item.confidence,
    confidenceReason: item.confidenceReason,
    evidence: item.evidence,
  }));

  // 9. Identify unresolved rules and attach session action summaries
  const unresolvedRules: CheckToolResult['unresolvedRules'] = [];
  for (const rule of rules) {
    const ruleResult = ruleResults.find((r) => r.text === rule.text);
    if (ruleResult && (ruleResult.method === 'unmapped' || (ruleResult.relevantSessions > 0 && ruleResult.resolvedSessions === 0))) {
      const sessionActions: CheckToolResult['unresolvedRules'][0]['sessionActions'] = [];

      // Use stored action summaries or gather from recent sessions
      for (const session of sessions) {
        const actions = sessionActionsMap.get(session.sessionId);
        if (actions) {
          sessionActions.push({
            sessionId: session.sessionId,
            bashCommands: actions.bashCommands.slice(0, 20), // limit for token sanity
            writtenFiles: actions.writtenFiles.slice(0, 20),
            editedFiles: actions.editedFiles.slice(0, 20),
          });
        }
      }

      if (sessionActions.length > 0) {
        unresolvedRules.push({
          text: rule.text,
          sessionActions,
        });
      }
    }
  }

  return {
    file: relPath,
    sessionCount: allResults.length,
    rules: ruleResults,
    unresolvedRules,
  };
}
