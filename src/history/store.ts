import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  unlinkSync,
  statSync,
} from 'node:fs';
import path, { join } from 'node:path';
import { loadEffectiveInstructionGraph } from '../parsers/instruction-loader.js';
import type { SessionResult } from './types.js';

const HISTORY_FILE = 'history.jsonl';
const LOCK_FILE = 'history.lock';
const LOCK_TIMEOUT_MS = 5_000;

export class HistoryStore {
  private readonly historyPath: string;
  private readonly lockPath: string;

  constructor(private dir: string) {
    this.historyPath = join(dir, HISTORY_FILE);
    this.lockPath = join(dir, LOCK_FILE);
  }

  /** Read all session results from history. */
  readAll(): SessionResult[] {
    if (!existsSync(this.historyPath)) {
      return [];
    }

    const content = readFileSync(this.historyPath, 'utf-8').trim();
    if (!content) {
      return [];
    }

    return content
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as SessionResult);
  }

  /** Check if a session is already recorded. */
  hasSession(
    sessionId: string,
    rulesVersion?: string,
    analysisVersion?: string,
  ): boolean {
    const results = this.readAll();
    return results.some(
      (r) =>
        r.sessionId === sessionId &&
        (rulesVersion === undefined || r.rulesVersion === rulesVersion) &&
        (analysisVersion === undefined || r.analysisVersion === analysisVersion),
    );
  }

  /** Append a session result (with dedup check and lockfile). */
  append(result: SessionResult): void {
    this.ensureDir();
    this.acquireLock();

    try {
      // Dedup check inside lock
      if (
        this.hasSession(
          result.sessionId,
          result.rulesVersion,
          result.analysisVersion,
        )
      ) {
        return;
      }

      appendFileSync(this.historyPath, JSON.stringify(result) + '\n', 'utf-8');
    } finally {
      this.releaseLock();
    }
  }

  /** Get the current rules version hash. */
  static computeRulesVersion(filePath: string, cwd?: string): string {
    const boundaryCwd = cwd ?? path.dirname(path.resolve(filePath));
    return loadEffectiveInstructionGraph(filePath, boundaryCwd).graphHash;
  }

  /** Remove a session from history (for --fresh re-analysis). */
  removeSession(
    sessionId: string,
    rulesVersion?: string,
    analysisVersion?: string,
  ): void {
    const results = this.readAll().filter(
      (r) =>
        !(
          r.sessionId === sessionId &&
          (rulesVersion === undefined || r.rulesVersion === rulesVersion) &&
          (analysisVersion === undefined || r.analysisVersion === analysisVersion)
        ),
    );
    this.ensureDir();
    writeFileSync(this.historyPath, results.map((r) => JSON.stringify(r)).join('\n') + (results.length > 0 ? '\n' : ''), 'utf-8');
  }

  /** Get all sessions for a specific rules version (epoch). */
  queryByEpoch(rulesVersion: string, analysisVersion?: string): SessionResult[] {
    return this.readAll().filter(
      (r) =>
        r.rulesVersion === rulesVersion &&
        (analysisVersion === undefined || r.analysisVersion === analysisVersion),
    );
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) {
      mkdirSync(this.dir, { recursive: true });
    }
  }

  private acquireLock(): void {
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    const pid = process.pid.toString();

    while (Date.now() < deadline) {
      try {
        writeFileSync(this.lockPath, pid, { flag: 'wx' });
        return; // Lock acquired
      } catch {
        // Lock exists — check if stale
        if (this.isLockStale()) {
          try {
            unlinkSync(this.lockPath);
          } catch {
            // Another process may have removed it
          }
          continue;
        }

        // Wait briefly before retry
        const waitMs = 50;
        const start = Date.now();
        while (Date.now() - start < waitMs) {
          // Busy-wait (synchronous)
        }
      }
    }

    throw new Error(`Failed to acquire lock at ${this.lockPath} within ${LOCK_TIMEOUT_MS}ms`);
  }

  private releaseLock(): void {
    try {
      unlinkSync(this.lockPath);
    } catch {
      // Lock may already be cleaned up
    }
  }

  private isLockStale(): boolean {
    try {
      const stat = statSync(this.lockPath);
      return Date.now() - stat.mtimeMs > LOCK_TIMEOUT_MS;
    } catch {
      return true;
    }
  }
}
