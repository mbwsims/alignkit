# Claude Code Session Log Schema

Confirmed by inspecting a live Claude Code installation (v2.1.78, March 2026).

## Directory Structure

```
~/.claude/
├── projects/
│   ├── -Users-you-projects-my-app/               # path-encoded
│   │   ├── 6dd49b50-...jsonl                      # session file
│   │   ├── subagents/
│   │   │   ├── agent-a470a53e802260a8e.jsonl
│   │   │   └── agent-a470a53e802260a8e.meta.json
│   │   └── memory/                                 # optional
│   ├── -Users-you-projects-monorepo-packages-api/
│   │   ├── sessions-index.json                     # only multi-session projects
│   │   ├── 68d10af6-...jsonl
│   │   ├── a1b2c3d4-...jsonl
│   │   └── ...
```

### Project Directory Naming

Path encoding: replace every `/` with `-`.
- `/Users/you/projects/my-app` → `-Users-you-projects-my-app`
- Decode: strip leading `-`, replace remaining `-` with `/`, prepend `/`

**Caveat:** This encoding is ambiguous if directory names contain hyphens. In practice this works because most paths don't have hyphens in the same positions as path separators. For robustness, match against CWD rather than trying to decode.

### sessions-index.json

**Not universal.** Only exists in projects with multiple sessions (older/active projects). Newer or single-session projects may have just the JSONL file with no index.

```typescript
interface SessionsIndex {
  version: number;  // observed: 1
  entries: SessionEntry[];
  originalPath?: string;  // primary project path
}

interface SessionEntry {
  sessionId: string;          // UUID v4
  fullPath: string;           // absolute path to .jsonl file
  fileMtime: number;          // Unix ms timestamp
  firstPrompt: string;        // "No prompt" or truncated user message
  summary?: string;           // human-readable title (newer sessions)
  messageCount: number;
  created: string;            // ISO 8601
  modified: string;           // ISO 8601
  gitBranch: string;
  projectPath: string;        // real filesystem project path
  isSidechain: boolean;
}
```

**Critical:** One sessions-index.json can contain entries with DIFFERENT `projectPath` values (e.g., monorepo root + sub-package).

### Discovery Strategy

1. Enumerate `~/.claude/projects/` subdirectories
2. For each, check for `sessions-index.json`:
   - If present: read entries, filter by `projectPath` matching CWD
   - If absent: list `.jsonl` files directly, use directory name to infer project
3. Match CWD to project directory by:
   - Checking `projectPath` in session entries
   - Falling back to path-encoding match on directory name

## JSONL Line Types

A session file contains multiple line types. **Not all lines are `{ type, message }`.**

### Line type frequency (observed in real session):

| type | count | contains tool actions? |
|---|---|---|
| `assistant` | ~500 | Yes (tool_use in message.content) |
| `user` | ~440 | Yes (tool_result in message.content) |
| `progress` | ~650 | No (UI progress tracking) |
| `agent_progress` | ~540 | No (subagent progress) |
| `hook_progress` | ~100 | No (hook execution) |
| `queue-operation` | ~30 | No (enqueue/dequeue) |
| `system` | ~16 | No (system events) |
| `last-prompt` | ~3 | No (session resume) |

**For alignkit, we only need `assistant` lines** — specifically the `tool_use` blocks within `message.content`.

### Common fields (on most line types):

```typescript
interface JournalLine {
  type: 'assistant' | 'user' | 'progress' | 'system' | 'queue-operation' | 'last-prompt';
  uuid: string;
  parentUuid: string | null;
  timestamp: string;            // ISO 8601
  sessionId: string;            // UUID v4
  cwd: string;                  // working directory
  version: string;              // Claude Code version (e.g., "2.1.78")
  gitBranch: string;
  isSidechain: boolean;
  userType: string;             // "external"
  entrypoint: string;           // "claude-desktop"
  slug?: string;                // session slug name
}
```

### Assistant line (contains tool_use blocks):

```typescript
interface AssistantLine extends JournalLine {
  type: 'assistant';
  message: {
    model: string;              // "claude-opus-4-6", "claude-sonnet-4-20250514", etc.
    id: string;                 // "msg_01..."
    type: 'message';
    role: 'assistant';
    content: Array<ThinkingBlock | TextBlock | ToolUseBlock>;
    stop_reason: string | null; // "tool_use", "end_turn", etc.
    usage: UsageInfo;
  };
  requestId: string;
}

interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature: string;
}

interface TextBlock {
  type: 'text';
  text: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;                   // "toolu_01..."
  name: string;                 // "Bash", "Read", "Write", "Edit", "Agent", etc.
  input: Record<string, unknown>;
  caller: { type: string };     // { type: "direct" }
}
```

### Tool input schemas:

**Bash:**
```json
{ "command": "git log --oneline -5", "description": "Check recent commits" }
```

**Read:**
```json
{ "file_path": "/absolute/path/to/file.ts" }
```

**Write:**
```json
{ "file_path": "/absolute/path/to/file.ts", "content": "full file content" }
```

**Edit:**
```json
{ "file_path": "/absolute/path", "old_string": "...", "new_string": "...", "replace_all": false }
```

**Agent:**
```json
{ "description": "...", "subagent_type": "Explore", "prompt": "..." }
```

### User line (contains tool_result):

```typescript
interface UserLine extends JournalLine {
  type: 'user';
  message: {
    role: 'user';
    content: string | Array<ToolResultBlock>;
  };
  toolUseResult?: unknown;      // tool result metadata
  sourceToolAssistantUUID?: string;
}

interface ToolResultBlock {
  type: 'tool_result';
  content: string;
  is_error?: boolean;
  tool_use_id: string;          // matches ToolUseBlock.id
}
```

### Subagent files:

Subagent sessions are stored separately in `subagents/` directory:
- `agent-{agentId}.jsonl` — same format as main session
- `agent-{agentId}.meta.json` — `{ "agentType": "general-purpose", "description": "..." }`

Subagent files should be included when parsing sessions, since agents delegate work there. A rule like "use pnpm" might be followed in a subagent session, not the main session.
