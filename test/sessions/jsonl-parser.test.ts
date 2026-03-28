import { describe, it, expect } from 'vitest';
import { parseSessionContent } from '../../src/sessions/jsonl-parser.js';

// Minimal JSONL fixture lines matching the schema from fixtures/SCHEMA.md
const bashLine = JSON.stringify({
  parentUuid: null,
  isSidechain: false,
  message: {
    model: 'claude-sonnet-4-20250514',
    id: 'msg_01X',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_01A',
        name: 'Bash',
        input: { command: 'pnpm test', description: 'Run tests' },
        caller: { type: 'direct' },
      },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 100, output_tokens: 50 },
  },
  requestId: 'req_01X',
  type: 'assistant',
  uuid: 'uuid1',
  timestamp: '2026-03-27T10:00:00.000Z',
  sessionId: 'sess-001',
  cwd: '/test',
  version: '2.1.78',
  gitBranch: 'main',
  userType: 'external',
  entrypoint: 'claude-desktop',
});

const writeLine = JSON.stringify({
  parentUuid: 'uuid1',
  isSidechain: false,
  message: {
    model: 'claude-sonnet-4-20250514',
    id: 'msg_02X',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_02A',
        name: 'Write',
        input: { file_path: '/tmp/test.ts', content: 'console.log("hello")' },
        caller: { type: 'direct' },
      },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 100, output_tokens: 50 },
  },
  requestId: 'req_02X',
  type: 'assistant',
  uuid: 'uuid2',
  timestamp: '2026-03-27T10:01:00.000Z',
  sessionId: 'sess-001',
  cwd: '/test',
  version: '2.1.78',
  gitBranch: 'main',
  userType: 'external',
  entrypoint: 'claude-desktop',
});

const editLine = JSON.stringify({
  parentUuid: 'uuid2',
  isSidechain: false,
  message: {
    model: 'claude-sonnet-4-20250514',
    id: 'msg_03X',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_03A',
        name: 'Edit',
        input: {
          file_path: '/tmp/test.ts',
          old_string: 'console.log("hello")',
          new_string: 'console.log("world")',
          replace_all: false,
        },
        caller: { type: 'direct' },
      },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 100, output_tokens: 50 },
  },
  requestId: 'req_03X',
  type: 'assistant',
  uuid: 'uuid3',
  timestamp: '2026-03-27T10:02:00.000Z',
  sessionId: 'sess-001',
  cwd: '/test',
  version: '2.1.78',
  gitBranch: 'main',
  userType: 'external',
  entrypoint: 'claude-desktop',
});

const readLine = JSON.stringify({
  parentUuid: 'uuid3',
  isSidechain: false,
  message: {
    model: 'claude-sonnet-4-20250514',
    id: 'msg_04X',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_04A',
        name: 'Read',
        input: { file_path: '/tmp/test.ts' },
        caller: { type: 'direct' },
      },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 100, output_tokens: 50 },
  },
  requestId: 'req_04X',
  type: 'assistant',
  uuid: 'uuid4',
  timestamp: '2026-03-27T10:03:00.000Z',
  sessionId: 'sess-001',
  cwd: '/test',
  version: '2.1.78',
  gitBranch: 'main',
  userType: 'external',
  entrypoint: 'claude-desktop',
});

const progressLine = JSON.stringify({
  type: 'progress',
  uuid: 'uuid-prog',
  timestamp: '2026-03-27T10:00:30.000Z',
  sessionId: 'sess-001',
});

const queueLine = JSON.stringify({
  type: 'queue-operation',
  uuid: 'uuid-q',
  timestamp: '2026-03-27T10:00:31.000Z',
  sessionId: 'sess-001',
});

const userLine = JSON.stringify({
  parentUuid: null,
  isSidechain: false,
  message: {
    role: 'user',
    content: 'Run the tests please',
  },
  type: 'user',
  uuid: 'uuid-u',
  timestamp: '2026-03-27T09:59:00.000Z',
  sessionId: 'sess-001',
  cwd: '/test',
  version: '2.1.78',
  gitBranch: 'main',
  userType: 'external',
  entrypoint: 'claude-desktop',
});

// Assistant line with thinking + text blocks (no tool_use)
const thinkingLine = JSON.stringify({
  parentUuid: 'uuid-u',
  isSidechain: false,
  message: {
    model: 'claude-opus-4-6',
    id: 'msg_05X',
    type: 'message',
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'Let me think about this...', signature: 'sig1' },
      { type: 'text', text: 'Sure, I will run the tests.' },
    ],
    stop_reason: 'end_turn',
    usage: { input_tokens: 200, output_tokens: 100 },
  },
  requestId: 'req_05X',
  type: 'assistant',
  uuid: 'uuid5',
  timestamp: '2026-03-27T09:59:30.000Z',
  sessionId: 'sess-001',
  cwd: '/test',
  version: '2.1.78',
  gitBranch: 'main',
  userType: 'external',
  entrypoint: 'claude-desktop',
});

// Assistant line with Agent tool (should be skipped)
const agentLine = JSON.stringify({
  parentUuid: 'uuid5',
  isSidechain: false,
  message: {
    model: 'claude-sonnet-4-20250514',
    id: 'msg_06X',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_06A',
        name: 'Agent',
        input: { description: 'search', subagent_type: 'Explore', prompt: 'Find files' },
        caller: { type: 'direct' },
      },
    ],
    stop_reason: 'tool_use',
    usage: { input_tokens: 100, output_tokens: 50 },
  },
  requestId: 'req_06X',
  type: 'assistant',
  uuid: 'uuid6',
  timestamp: '2026-03-27T10:04:00.000Z',
  sessionId: 'sess-001',
  cwd: '/test',
  version: '2.1.78',
  gitBranch: 'main',
  userType: 'external',
  entrypoint: 'claude-desktop',
});

describe('parseSessionContent', () => {
  const fullFixture = [
    userLine,
    thinkingLine,
    progressLine,
    bashLine,
    queueLine,
    writeLine,
    editLine,
    readLine,
    agentLine,
  ].join('\n');

  it('extracts only actions from assistant lines', () => {
    const actions = parseSessionContent(fullFixture);
    // bash + write + edit + read = 4 (thinking-only assistant has 0, agent is skipped)
    expect(actions).toHaveLength(4);
  });

  it('extracts Bash action with command field', () => {
    const actions = parseSessionContent(bashLine);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      type: 'bash',
      command: 'pnpm test',
      timestamp: '2026-03-27T10:00:00.000Z',
    });
  });

  it('extracts Write action with filePath and content', () => {
    const actions = parseSessionContent(writeLine);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      type: 'write',
      filePath: '/tmp/test.ts',
      content: 'console.log("hello")',
      timestamp: '2026-03-27T10:01:00.000Z',
    });
  });

  it('extracts Edit action with filePath, oldContent, newContent', () => {
    const actions = parseSessionContent(editLine);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      type: 'edit',
      filePath: '/tmp/test.ts',
      oldContent: 'console.log("hello")',
      newContent: 'console.log("world")',
      timestamp: '2026-03-27T10:02:00.000Z',
    });
  });

  it('extracts Read action with filePath', () => {
    const actions = parseSessionContent(readLine);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      type: 'read',
      filePath: '/tmp/test.ts',
      timestamp: '2026-03-27T10:03:00.000Z',
    });
  });

  it('skips malformed JSON lines', () => {
    const content = [
      'NOT VALID JSON',
      bashLine,
      '{ broken',
    ].join('\n');
    const actions = parseSessionContent(content);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('bash');
  });

  it('skips non-assistant lines (progress, queue-operation, user)', () => {
    const content = [progressLine, queueLine, userLine].join('\n');
    const actions = parseSessionContent(content);
    expect(actions).toHaveLength(0);
  });

  it('skips non-tool_use content blocks (thinking, text)', () => {
    const actions = parseSessionContent(thinkingLine);
    expect(actions).toHaveLength(0);
  });

  it('skips unrecognized tool names (Agent)', () => {
    const actions = parseSessionContent(agentLine);
    expect(actions).toHaveLength(0);
  });

  it('handles empty input', () => {
    const actions = parseSessionContent('');
    expect(actions).toHaveLength(0);
  });

  it('handles multiple tool_use blocks in one assistant message', () => {
    const multiToolLine = JSON.stringify({
      parentUuid: null,
      isSidechain: false,
      message: {
        model: 'claude-sonnet-4-20250514',
        id: 'msg_multi',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_m1',
            name: 'Bash',
            input: { command: 'echo a' },
            caller: { type: 'direct' },
          },
          {
            type: 'tool_use',
            id: 'toolu_m2',
            name: 'Read',
            input: { file_path: '/tmp/a.txt' },
            caller: { type: 'direct' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
      requestId: 'req_multi',
      type: 'assistant',
      uuid: 'uuid-multi',
      timestamp: '2026-03-27T10:05:00.000Z',
      sessionId: 'sess-001',
      cwd: '/test',
      version: '2.1.78',
      gitBranch: 'main',
      userType: 'external',
      entrypoint: 'claude-desktop',
    });
    const actions = parseSessionContent(multiToolLine);
    expect(actions).toHaveLength(2);
    expect(actions[0].type).toBe('bash');
    expect(actions[1].type).toBe('read');
  });
});
