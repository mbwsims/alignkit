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

interface ParsedSession {
  sessionId: string;
  actions: AgentAction[];
  timestamp: string;
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

  // Collect session IDs we've already processed (to avoid duplicates
  // when both index and direct file scan find the same session)
  const seen = new Set<string>();

  if (existsSync(indexPath)) {
    // Strategy 1: use sessions-index.json
    const indexData = JSON.parse(readFileSync(indexPath, 'utf8')) as {
      entries?: SessionEntry[];
    };

    // Match sessions where projectPath matches CWD, or either is a
    // parent of the other. This handles monorepos where CWD is the root
    // but sessions were started from sub-packages, or vice versa.
    const entries = (indexData.entries ?? []).filter(
      (entry) =>
        entry.projectPath === cwd ||
        entry.projectPath.startsWith(cwd + '/') ||
        cwd.startsWith(entry.projectPath + '/'),
    );

    // Mark all matched entries as seen (even if filtered by `since`)
    // so the fallback file scan doesn't re-include them.
    for (const entry of entries) {
      seen.add(entry.sessionId);
    }

    const filteredEntries = since
      ? entries.filter((entry) => new Date(entry.modified).getTime() > since.getTime())
      : entries;

    for (const entry of filteredEntries) {
      if (!existsSync(entry.fullPath)) continue;

      // Skip active sessions
      const stat = statSync(entry.fullPath);
      if (now - stat.mtimeMs < ACTIVE_SESSION_THRESHOLD_MS) continue;

      seen.add(entry.sessionId);
      sessions.push({
        sessionId: entry.sessionId,
        actions: parseSessionFile(entry.fullPath),
        timestamp: entry.modified,
      });
    }
  }

  // Strategy 2: also scan for JSONL files not listed in the index.
  // The index may be incomplete (not all sessions get indexed).
  {
    let files: string[];
    try {
      files = readdirSync(projectDir)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => join(projectDir, f));
    } catch {
      files = [];
    }

    for (const filePath of files) {
      const stat = statSync(filePath);

      // Skip active sessions
      if (now - stat.mtimeMs < ACTIVE_SESSION_THRESHOLD_MS) continue;

      // Filter by mtime if since is set
      if (since && stat.mtimeMs <= since.getTime()) continue;

      // Extract sessionId and skip if already processed from index
      const sessionId = extractSessionId(filePath) ?? basename(filePath, '.jsonl');
      if (seen.has(sessionId)) continue;

      const actions = parseSessionFile(filePath);

      // Determine timestamp from first action or file mtime
      const timestamp =
        actions.length > 0
          ? actions[0].timestamp
          : new Date(stat.mtimeMs).toISOString();

      seen.add(sessionId);
      sessions.push({
        sessionId,
        actions,
        timestamp,
      });
    }
  }

  // Sort by timestamp ascending
  sessions.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (includeSubagents && sessions.length > 0) {
    attachSubagentActions(projectDir, sessions, since, now);
  }

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

function attachSubagentActions(
  projectDir: string,
  sessions: SessionData[],
  since: Date | undefined,
  now: number,
): void {
  const subagentSessions = readSubagentSessions(projectDir, since, now);
  if (subagentSessions.length === 0) return;

  for (const subagent of subagentSessions) {
    const targetIndex = findOwningSessionIndex(sessions, subagent.timestamp);
    if (targetIndex === -1) continue;
    sessions[targetIndex].actions.push(...subagent.actions);
  }
}

function findOwningSessionIndex(
  sessions: SessionData[],
  subagentTimestamp: string,
): number {
  if (sessions.length === 0) return -1;
  if (sessions.length === 1) return 0;

  const subagentTime = Date.parse(subagentTimestamp);
  if (Number.isNaN(subagentTime)) {
    return sessions.length - 1;
  }

  for (let i = 0; i < sessions.length; i++) {
    const currentTime = Date.parse(sessions[i].timestamp);
    const nextTime = i < sessions.length - 1 ? Date.parse(sessions[i + 1].timestamp) : Number.POSITIVE_INFINITY;

    const isAfterCurrent = Number.isNaN(currentTime) || subagentTime >= currentTime;
    const isBeforeNext = Number.isNaN(nextTime) || subagentTime < nextTime;

    if (isAfterCurrent && isBeforeNext) {
      return i;
    }
  }

  return subagentTime < Date.parse(sessions[0].timestamp) ? 0 : sessions.length - 1;
}

/**
 * Read subagent JSONL files as independent transcripts.
 */
function readSubagentSessions(
  projectDir: string,
  since: Date | undefined,
  now: number,
): ParsedSession[] {
  const subagentsDir = join(projectDir, 'subagents');
  if (!existsSync(subagentsDir)) return [];

  const sessions: ParsedSession[] = [];

  try {
    const files = readdirSync(subagentsDir).filter(
      (f) => f.startsWith('agent-') && f.endsWith('.jsonl'),
    );

    for (const file of files) {
      const filePath = join(subagentsDir, file);
      const stat = statSync(filePath);

      if (now - stat.mtimeMs < ACTIVE_SESSION_THRESHOLD_MS) continue;
      if (since && stat.mtimeMs <= since.getTime()) continue;

      const actions = parseSessionFile(filePath);
      const timestamp =
        actions.length > 0
          ? actions[0].timestamp
          : new Date(stat.mtimeMs).toISOString();

      sessions.push({
        sessionId: basename(filePath, '.jsonl'),
        actions,
        timestamp,
      });
    }
  } catch {
    // Ignore errors reading subagent files
  }

  sessions.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return sessions;
}
