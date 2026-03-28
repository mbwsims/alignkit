import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { resolveProjectDir } from './project-resolver.js';
import { parseSessionFile } from './jsonl-parser.js';
import type { AgentAction } from './types.js';

export interface ReadSessionsOptions {
  cwd: string;
  claudeDir?: string;
  since?: Date;
  includeSubagents?: boolean; // default true
}

export interface SessionData {
  sessionId: string;
  actions: AgentAction[];
  timestamp: string;
}

/** Two minutes in milliseconds — sessions modified within this window are considered active. */
const ACTIVE_SESSION_THRESHOLD_MS = 2 * 60 * 1000;

interface SessionEntry {
  sessionId: string;
  fullPath: string;
  projectPath: string;
  modified: string;
}

/**
 * Read and parse Claude Code sessions for a given project directory.
 */
export function readSessions(options: ReadSessionsOptions): SessionData[] {
  const { cwd, claudeDir, since, includeSubagents = true } = options;

  const projectDir = resolveProjectDir(cwd, claudeDir);
  if (!projectDir) {
    return [];
  }

  const now = Date.now();
  const sessions: SessionData[] = [];

  const indexPath = join(projectDir, 'sessions-index.json');

  if (existsSync(indexPath)) {
    // Strategy: use sessions-index.json
    const indexData = JSON.parse(readFileSync(indexPath, 'utf8')) as {
      entries?: SessionEntry[];
    };

    const entries = (indexData.entries ?? []).filter(
      (entry) => entry.projectPath === cwd,
    );

    const filteredEntries = since
      ? entries.filter((entry) => new Date(entry.modified).getTime() > since.getTime())
      : entries;

    for (const entry of filteredEntries) {
      if (!existsSync(entry.fullPath)) continue;

      // Skip active sessions
      const stat = statSync(entry.fullPath);
      if (now - stat.mtimeMs < ACTIVE_SESSION_THRESHOLD_MS) continue;

      const actions = parseSessionFile(entry.fullPath);

      // Merge subagent actions if requested
      if (includeSubagents) {
        const subagentActions = readSubagentActions(projectDir);
        actions.push(...subagentActions);
      }

      sessions.push({
        sessionId: entry.sessionId,
        actions,
        timestamp: entry.modified,
      });
    }
  } else {
    // Fallback: list JSONL files directly
    let files: string[];
    try {
      files = readdirSync(projectDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => join(projectDir, f));
    } catch {
      return [];
    }

    for (const filePath of files) {
      const stat = statSync(filePath);

      // Skip active sessions
      if (now - stat.mtimeMs < ACTIVE_SESSION_THRESHOLD_MS) continue;

      // Filter by mtime if since is set
      if (since && stat.mtimeMs <= since.getTime()) continue;

      const actions = parseSessionFile(filePath);

      // Extract sessionId from first line
      const sessionId = extractSessionId(filePath) ?? basename(filePath, '.jsonl');

      // Determine timestamp from first action or file mtime
      const timestamp =
        actions.length > 0
          ? actions[0].timestamp
          : new Date(stat.mtimeMs).toISOString();

      // Merge subagent actions if requested
      if (includeSubagents) {
        const subagentActions = readSubagentActions(projectDir);
        actions.push(...subagentActions);
      }

      sessions.push({
        sessionId,
        actions,
        timestamp,
      });
    }
  }

  // Sort by timestamp ascending
  sessions.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return sessions;
}

/**
 * Extract the sessionId from the first valid JSON line in a JSONL file.
 */
function extractSessionId(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, 'utf8');
    const firstLine = content.split('\n')[0]?.trim();
    if (!firstLine) return null;

    const parsed = JSON.parse(firstLine) as { sessionId?: string };
    return parsed.sessionId ?? null;
  } catch {
    return null;
  }
}

/**
 * Read all subagent JSONL files from the subagents/ directory.
 */
function readSubagentActions(projectDir: string): AgentAction[] {
  const subagentsDir = join(projectDir, 'subagents');
  if (!existsSync(subagentsDir)) return [];

  const actions: AgentAction[] = [];

  try {
    const files = readdirSync(subagentsDir).filter(
      (f) => f.startsWith('agent-') && f.endsWith('.jsonl'),
    );

    for (const file of files) {
      const filePath = join(subagentsDir, file);
      actions.push(...parseSessionFile(filePath));
    }
  } catch {
    // Ignore errors reading subagent files
  }

  return actions;
}
