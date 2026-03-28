import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  acquirePidFile,
  cleanupPidFile,
  isProcessAlive,
  readCursor,
  writeCursor,
} from '../../src/cli/watch.js';

describe('watch command utilities', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('PID file management', () => {
    it('creates a PID file with current process ID', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'alignkit-watch-test-'));
      const pidPath = path.join(tmpDir, 'watch.pid');

      const acquired = acquirePidFile(pidPath);
      expect(acquired).toBe(true);
      expect(existsSync(pidPath)).toBe(true);

      const storedPid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
      expect(storedPid).toBe(process.pid);
    });

    it('refuses to start if PID file exists and process is alive', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'alignkit-watch-test-'));
      const pidPath = path.join(tmpDir, 'watch.pid');

      // Write current PID (which is alive)
      writeFileSync(pidPath, String(process.pid), 'utf-8');

      const acquired = acquirePidFile(pidPath);
      expect(acquired).toBe(false);
    });

    it('replaces stale PID file (dead process)', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'alignkit-watch-test-'));
      const pidPath = path.join(tmpDir, 'watch.pid');

      // Write a PID that is very unlikely to be alive
      writeFileSync(pidPath, '999999999', 'utf-8');

      const acquired = acquirePidFile(pidPath);
      expect(acquired).toBe(true);

      const storedPid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
      expect(storedPid).toBe(process.pid);
    });

    it('cleans up PID file on exit', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'alignkit-watch-test-'));
      const pidPath = path.join(tmpDir, 'watch.pid');

      writeFileSync(pidPath, String(process.pid), 'utf-8');
      cleanupPidFile(pidPath);
      expect(existsSync(pidPath)).toBe(false);
    });

    it('does not clean up PID file owned by another process', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'alignkit-watch-test-'));
      const pidPath = path.join(tmpDir, 'watch.pid');

      writeFileSync(pidPath, '12345', 'utf-8');
      cleanupPidFile(pidPath);
      // File should still exist since it belongs to a different PID
      expect(existsSync(pidPath)).toBe(true);
    });
  });

  describe('isProcessAlive', () => {
    it('returns true for the current process', () => {
      expect(isProcessAlive(process.pid)).toBe(true);
    });

    it('returns false for a non-existent PID', () => {
      expect(isProcessAlive(999999999)).toBe(false);
    });
  });

  describe('cursor management', () => {
    it('returns null when cursor file does not exist', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'alignkit-watch-test-'));
      const cursorPath = path.join(tmpDir, 'watch.cursor');

      expect(readCursor(cursorPath)).toBeNull();
    });

    it('returns null for empty cursor file', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'alignkit-watch-test-'));
      const cursorPath = path.join(tmpDir, 'watch.cursor');
      writeFileSync(cursorPath, '', 'utf-8');

      expect(readCursor(cursorPath)).toBeNull();
    });

    it('reads and writes cursor value', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'alignkit-watch-test-'));
      const cursorPath = path.join(tmpDir, 'watch.cursor');

      const ts = '2025-01-15T10:30:00.000Z';
      writeCursor(cursorPath, ts);

      expect(readCursor(cursorPath)).toBe(ts);
    });

    it('overwrites existing cursor value', () => {
      tmpDir = mkdtempSync(path.join(tmpdir(), 'alignkit-watch-test-'));
      const cursorPath = path.join(tmpDir, 'watch.cursor');

      writeCursor(cursorPath, '2025-01-15T10:00:00.000Z');
      writeCursor(cursorPath, '2025-01-15T11:00:00.000Z');

      expect(readCursor(cursorPath)).toBe('2025-01-15T11:00:00.000Z');
    });
  });
});
