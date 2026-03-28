import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Command } from 'commander';
import { discoverInstructionFiles, parseInstructionFile } from '../parsers/auto-detect.js';
import { readSessions } from '../sessions/session-reader.js';
import { verifySession } from '../verifiers/verifier-engine.js';
import { HistoryStore } from '../history/store.js';
import type { Observation } from '../verifiers/types.js';
import type { SerializedObservation, SessionResult } from '../history/types.js';

const ANALYSIS_VERSION = '0.1.0';

function serializeObservation(obs: Observation): SerializedObservation {
  return {
    ruleId: obs.ruleId,
    sessionId: obs.sessionId,
    relevant: obs.relevant,
    followed: obs.relevant ? obs.followed : null,
    method: obs.method,
    confidence: obs.confidence,
  };
}

function formatTime(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function hashFile(filePath: string): string {
  const content = readFileSync(filePath, 'utf-8');
  return createHash('sha256').update(content).digest('hex').slice(0, 12);
}

/**
 * Check if a process with the given PID is alive.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write the PID file. Returns false if another watch process is already running.
 */
export function acquirePidFile(pidPath: string): boolean {
  if (existsSync(pidPath)) {
    const existingPid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
    if (!isNaN(existingPid) && isProcessAlive(existingPid)) {
      return false;
    }
    // Stale PID file — remove it
    unlinkSync(pidPath);
  }
  writeFileSync(pidPath, String(process.pid), 'utf-8');
  return true;
}

/**
 * Clean up PID file on exit.
 */
export function cleanupPidFile(pidPath: string): void {
  try {
    if (existsSync(pidPath)) {
      const storedPid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
      if (storedPid === process.pid) {
        unlinkSync(pidPath);
      }
    }
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Read the cursor (last processed session timestamp).
 */
export function readCursor(cursorPath: string): string | null {
  if (!existsSync(cursorPath)) return null;
  const value = readFileSync(cursorPath, 'utf-8').trim();
  return value || null;
}

/**
 * Write the cursor with the latest processed session timestamp.
 */
export function writeCursor(cursorPath: string, value: string): void {
  writeFileSync(cursorPath, value, 'utf-8');
}

export function registerWatchCommand(program: Command): void {
  program
    .command('watch [file]')
    .description('Background daemon that polls for new sessions and appends to history')
    .option('--interval <seconds>', 'Polling interval in seconds', '30')
    .option('--quiet', 'Suppress per-session output')
    .action(async (file: string | undefined, options: { interval: string; quiet?: boolean }) => {
      const cwd = process.cwd();
      const intervalMs = parseInt(options.interval, 10) * 1000;

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

      // 2. Parse rules and compute version
      const content = readFileSync(filePath, 'utf-8');
      let rules = parseInstructionFile(content, filePath);
      let rulesVersion = HistoryStore.computeRulesVersion(filePath);
      let fileHash = hashFile(filePath);

      // 3. Resolve alignkit directory
      const alignkitDir = path.join(cwd, '.alignkit');
      if (!existsSync(alignkitDir)) {
        mkdirSync(alignkitDir, { recursive: true });
      }

      const pidPath = path.join(alignkitDir, 'watch.pid');
      const cursorPath = path.join(alignkitDir, 'watch.cursor');

      // 4. PID file — refuse if another watch is running
      if (!acquirePidFile(pidPath)) {
        console.error('Error: Another watch process is already running.');
        process.exit(1);
      }

      // 5. Write initial cursor
      if (!existsSync(cursorPath)) {
        writeFileSync(cursorPath, '', 'utf-8');
      }

      // 6. Register signal handlers
      const cleanup = (): void => {
        cleanupPidFile(pidPath);
        process.exit(0);
      };
      process.on('SIGTERM', cleanup);
      process.on('SIGINT', cleanup);

      if (!options.quiet) {
        console.log(`[${formatTime()}] Watch started — polling every ${options.interval}s`);
      }

      // 7. Polling loop
      const store = new HistoryStore(alignkitDir);

      const poll = (): void => {
        try {
          // Check if instruction file changed
          const currentHash = hashFile(filePath);
          if (currentHash !== fileHash) {
            fileHash = currentHash;
            const newContent = readFileSync(filePath, 'utf-8');
            rules = parseInstructionFile(newContent, filePath);
            rulesVersion = HistoryStore.computeRulesVersion(filePath);
            if (!options.quiet) {
              console.log(`[${formatTime()}] Instruction file changed — new tracking epoch`);
            }
          }

          // Read sessions since cursor
          const cursor = readCursor(cursorPath);
          const since = cursor ? new Date(cursor) : undefined;
          const sessions = readSessions({ cwd, since });

          for (const session of sessions) {
            if (store.hasSession(session.sessionId)) continue;

            const observations = verifySession(rules, session.actions, session.sessionId);
            const result: SessionResult = {
              sessionId: session.sessionId,
              timestamp: session.timestamp,
              rulesVersion,
              analysisVersion: ANALYSIS_VERSION,
              observations: observations.map(serializeObservation),
            };

            store.append(result);

            if (!options.quiet) {
              const relevant = observations.filter((o) => o.relevant).length;
              const followed = observations.filter(
                (o) => o.relevant && 'followed' in o && o.followed === true,
              ).length;
              const pct = relevant > 0 ? Math.round((followed / relevant) * 100) : 0;
              console.log(
                `[${formatTime()}] Session ${session.sessionId.slice(0, 8)} — ${relevant} rules relevant, ${followed} followed (${pct}%)`,
              );
            }

            writeCursor(cursorPath, session.timestamp);
          }
        } catch (err) {
          if (!options.quiet) {
            console.error(`[${formatTime()}] Poll error:`, err);
          }
        }
      };

      // Initial poll
      poll();

      // Continue polling
      setInterval(poll, intervalMs);
    });
}
