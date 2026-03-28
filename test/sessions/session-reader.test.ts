import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readSessions } from '../../src/sessions/session-reader.js';

function makeAssistantLine(opts: {
  toolName: string;
  input: Record<string, unknown>;
  timestamp: string;
  sessionId: string;
}): string {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    message: {
      model: 'claude-sonnet-4-20250514',
      id: `msg_${opts.timestamp}`,
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: `toolu_${opts.timestamp}`,
          name: opts.toolName,
          input: opts.input,
          caller: { type: 'direct' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    },
    requestId: `req_${opts.timestamp}`,
    type: 'assistant',
    uuid: `uuid_${opts.timestamp}`,
    timestamp: opts.timestamp,
    sessionId: opts.sessionId,
    cwd: '/test',
    version: '2.1.78',
    gitBranch: 'main',
    userType: 'external',
    entrypoint: 'claude-desktop',
  });
}

describe('readSessions', () => {
  let tmpDir: string;
  const cwd = '/Users/msims/Documents/GitHub/test-project';
  const encoded = '-Users-msims-Documents-GitHub-test-project';

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'agentlint-session-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function createProjectDir(): string {
    const projectDir = join(tmpDir, encoded);
    mkdirSync(projectDir, { recursive: true });
    return projectDir;
  }

  function writeJsonlFile(dir: string, filename: string, lines: string[], mtimeAge?: number): string {
    const filePath = join(dir, filename);
    writeFileSync(filePath, lines.join('\n'));
    if (mtimeAge !== undefined) {
      const mtime = new Date(Date.now() - mtimeAge);
      utimesSync(filePath, mtime, mtime);
    }
    return filePath;
  }

  it('returns empty array when project directory is not found', () => {
    const sessions = readSessions({ cwd, claudeDir: tmpDir });
    expect(sessions).toEqual([]);
  });

  describe('with sessions-index.json', () => {
    it('reads sessions matching CWD from index', () => {
      const projectDir = createProjectDir();
      const line1 = makeAssistantLine({
        toolName: 'Bash',
        input: { command: 'echo hello' },
        timestamp: '2026-03-27T10:00:00.000Z',
        sessionId: 'sess-001',
      });
      const jsonlPath = writeJsonlFile(projectDir, 'sess-001.jsonl', [line1], 5 * 60 * 1000);

      const indexData = {
        version: 1,
        entries: [
          {
            sessionId: 'sess-001',
            fullPath: jsonlPath,
            projectPath: cwd,
            modified: '2026-03-27T10:00:00.000Z',
          },
          {
            sessionId: 'sess-002',
            fullPath: join(projectDir, 'sess-002.jsonl'),
            projectPath: '/different/project',
            modified: '2026-03-27T09:00:00.000Z',
          },
        ],
      };
      writeFileSync(join(projectDir, 'sessions-index.json'), JSON.stringify(indexData));

      const sessions = readSessions({ cwd, claudeDir: tmpDir });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('sess-001');
      expect(sessions[0].actions).toHaveLength(1);
      expect(sessions[0].actions[0].type).toBe('bash');
    });

    it('filters sessions by since date', () => {
      const projectDir = createProjectDir();
      const line1 = makeAssistantLine({
        toolName: 'Bash',
        input: { command: 'echo old' },
        timestamp: '2026-03-20T10:00:00.000Z',
        sessionId: 'sess-old',
      });
      const line2 = makeAssistantLine({
        toolName: 'Bash',
        input: { command: 'echo new' },
        timestamp: '2026-03-27T10:00:00.000Z',
        sessionId: 'sess-new',
      });

      const oldPath = writeJsonlFile(projectDir, 'sess-old.jsonl', [line1], 10 * 60 * 1000);
      const newPath = writeJsonlFile(projectDir, 'sess-new.jsonl', [line2], 5 * 60 * 1000);

      const indexData = {
        version: 1,
        entries: [
          {
            sessionId: 'sess-old',
            fullPath: oldPath,
            projectPath: cwd,
            modified: '2026-03-20T10:00:00.000Z',
          },
          {
            sessionId: 'sess-new',
            fullPath: newPath,
            projectPath: cwd,
            modified: '2026-03-27T10:00:00.000Z',
          },
        ],
      };
      writeFileSync(join(projectDir, 'sessions-index.json'), JSON.stringify(indexData));

      const sessions = readSessions({
        cwd,
        claudeDir: tmpDir,
        since: new Date('2026-03-25T00:00:00.000Z'),
      });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('sess-new');
    });
  });

  describe('without sessions-index.json', () => {
    it('reads JSONL files directly and extracts sessionId from first line', () => {
      const projectDir = createProjectDir();
      const line = makeAssistantLine({
        toolName: 'Read',
        input: { file_path: '/tmp/file.ts' },
        timestamp: '2026-03-27T10:00:00.000Z',
        sessionId: 'sess-direct',
      });
      writeJsonlFile(projectDir, 'sess-direct.jsonl', [line], 5 * 60 * 1000);

      const sessions = readSessions({ cwd, claudeDir: tmpDir, includeSubagents: false });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('sess-direct');
      expect(sessions[0].actions).toHaveLength(1);
      expect(sessions[0].actions[0].type).toBe('read');
    });

    it('filters by file mtime when since is set', () => {
      const projectDir = createProjectDir();
      const oldLine = makeAssistantLine({
        toolName: 'Bash',
        input: { command: 'echo old' },
        timestamp: '2026-03-20T10:00:00.000Z',
        sessionId: 'sess-old',
      });
      const newLine = makeAssistantLine({
        toolName: 'Bash',
        input: { command: 'echo new' },
        timestamp: '2026-03-27T10:00:00.000Z',
        sessionId: 'sess-new',
      });

      // Old file: mtime 10 days ago
      writeJsonlFile(projectDir, 'sess-old.jsonl', [oldLine], 10 * 24 * 60 * 60 * 1000);
      // New file: mtime 5 minutes ago
      writeJsonlFile(projectDir, 'sess-new.jsonl', [newLine], 5 * 60 * 1000);

      const sessions = readSessions({
        cwd,
        claudeDir: tmpDir,
        since: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
        includeSubagents: false,
      });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('sess-new');
    });
  });

  describe('active session skipping', () => {
    it('skips files modified less than 2 minutes ago', () => {
      const projectDir = createProjectDir();
      const line = makeAssistantLine({
        toolName: 'Bash',
        input: { command: 'echo active' },
        timestamp: '2026-03-27T10:00:00.000Z',
        sessionId: 'sess-active',
      });

      // File modified just now (active session)
      writeJsonlFile(projectDir, 'sess-active.jsonl', [line]);

      const sessions = readSessions({ cwd, claudeDir: tmpDir, includeSubagents: false });
      expect(sessions).toHaveLength(0);
    });
  });

  describe('subagent merging', () => {
    it('includes subagent actions when includeSubagents is true', () => {
      const projectDir = createProjectDir();
      const mainLine = makeAssistantLine({
        toolName: 'Bash',
        input: { command: 'echo main' },
        timestamp: '2026-03-27T10:00:00.000Z',
        sessionId: 'sess-main',
      });
      writeJsonlFile(projectDir, 'sess-main.jsonl', [mainLine], 5 * 60 * 1000);

      // Create subagent file
      const subagentDir = join(projectDir, 'subagents');
      mkdirSync(subagentDir, { recursive: true });
      const subLine = makeAssistantLine({
        toolName: 'Read',
        input: { file_path: '/tmp/sub.ts' },
        timestamp: '2026-03-27T10:01:00.000Z',
        sessionId: 'sess-sub',
      });
      writeFileSync(join(subagentDir, 'agent-abc123.jsonl'), subLine);

      const sessions = readSessions({ cwd, claudeDir: tmpDir, includeSubagents: true });
      expect(sessions).toHaveLength(1);
      // Main action + subagent action
      expect(sessions[0].actions).toHaveLength(2);
      const types = sessions[0].actions.map((a) => a.type);
      expect(types).toContain('bash');
      expect(types).toContain('read');
    });

    it('excludes subagent actions when includeSubagents is false', () => {
      const projectDir = createProjectDir();
      const mainLine = makeAssistantLine({
        toolName: 'Bash',
        input: { command: 'echo main' },
        timestamp: '2026-03-27T10:00:00.000Z',
        sessionId: 'sess-main',
      });
      writeJsonlFile(projectDir, 'sess-main.jsonl', [mainLine], 5 * 60 * 1000);

      const subagentDir = join(projectDir, 'subagents');
      mkdirSync(subagentDir, { recursive: true });
      const subLine = makeAssistantLine({
        toolName: 'Read',
        input: { file_path: '/tmp/sub.ts' },
        timestamp: '2026-03-27T10:01:00.000Z',
        sessionId: 'sess-sub',
      });
      writeFileSync(join(subagentDir, 'agent-abc123.jsonl'), subLine);

      const sessions = readSessions({ cwd, claudeDir: tmpDir, includeSubagents: false });
      expect(sessions).toHaveLength(1);
      expect(sessions[0].actions).toHaveLength(1);
      expect(sessions[0].actions[0].type).toBe('bash');
    });
  });

  describe('sorting', () => {
    it('returns sessions sorted by timestamp', () => {
      const projectDir = createProjectDir();
      const line1 = makeAssistantLine({
        toolName: 'Bash',
        input: { command: 'echo second' },
        timestamp: '2026-03-27T12:00:00.000Z',
        sessionId: 'sess-second',
      });
      const line2 = makeAssistantLine({
        toolName: 'Bash',
        input: { command: 'echo first' },
        timestamp: '2026-03-27T08:00:00.000Z',
        sessionId: 'sess-first',
      });

      const path1 = writeJsonlFile(projectDir, 'sess-second.jsonl', [line1], 5 * 60 * 1000);
      const path2 = writeJsonlFile(projectDir, 'sess-first.jsonl', [line2], 10 * 60 * 1000);

      const indexData = {
        version: 1,
        entries: [
          {
            sessionId: 'sess-second',
            fullPath: path1,
            projectPath: cwd,
            modified: '2026-03-27T12:00:00.000Z',
          },
          {
            sessionId: 'sess-first',
            fullPath: path2,
            projectPath: cwd,
            modified: '2026-03-27T08:00:00.000Z',
          },
        ],
      };
      writeFileSync(join(projectDir, 'sessions-index.json'), JSON.stringify(indexData));

      const sessions = readSessions({ cwd, claudeDir: tmpDir, includeSubagents: false });
      expect(sessions).toHaveLength(2);
      expect(sessions[0].sessionId).toBe('sess-first');
      expect(sessions[1].sessionId).toBe('sess-second');
    });
  });
});
