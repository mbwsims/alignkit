import { readFileSync } from 'node:fs';
import type { AgentAction } from './types.js';

interface ToolUseBlock {
  type: 'tool_use';
  name: string;
  input: Record<string, unknown>;
}

interface AssistantLine {
  type: 'assistant';
  timestamp: string;
  message: {
    content: Array<{ type: string } & Record<string, unknown>>;
  };
}

/**
 * Parse a single tool_use block into an AgentAction, or return null if unrecognized.
 */
function toolUseToAction(block: ToolUseBlock, timestamp: string): AgentAction | null {
  const { name, input } = block;

  switch (name) {
    case 'Bash':
      return {
        type: 'bash',
        command: (input.command as string) ?? '',
        timestamp,
      };
    case 'Write':
      return {
        type: 'write',
        filePath: (input.file_path as string) ?? '',
        content: (input.content as string) ?? '',
        timestamp,
      };
    case 'Edit':
      return {
        type: 'edit',
        filePath: (input.file_path as string) ?? '',
        oldContent: (input.old_string as string) ?? '',
        newContent: (input.new_string as string) ?? '',
        timestamp,
      };
    case 'Read':
      return {
        type: 'read',
        filePath: (input.file_path as string) ?? '',
        timestamp,
      };
    default:
      return null;
  }
}

/**
 * Parse a JSONL session file and extract AgentActions.
 *
 * Only processes lines where type === 'assistant', then extracts
 * tool_use blocks from message.content.
 */
export function parseSessionFile(filePath: string): AgentAction[] {
  const content = readFileSync(filePath, 'utf8');
  return parseSessionContent(content);
}

/**
 * Parse JSONL content string and extract AgentActions.
 * Exported for testing without filesystem dependency.
 */
export function parseSessionContent(content: string): AgentAction[] {
  const actions: AgentAction[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // Skip malformed JSON lines
      continue;
    }

    // Only process assistant lines
    if (parsed.type !== 'assistant') continue;

    const assistantLine = parsed as unknown as AssistantLine;
    const message = assistantLine.message;
    if (!message?.content || !Array.isArray(message.content)) continue;

    const timestamp = assistantLine.timestamp ?? '';

    for (const block of message.content) {
      if (block.type !== 'tool_use') continue;

      const action = toolUseToAction(block as unknown as ToolUseBlock, timestamp);
      if (action) {
        actions.push(action);
      }
    }
  }

  return actions;
}
