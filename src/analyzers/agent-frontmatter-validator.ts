import { readFileSync } from 'node:fs';
import { isClaudeAgentFilePath } from '../parsers/instruction-paths.js';
import type { Diagnostic, Rule } from '../parsers/types.js';

interface AgentFrontmatter {
  hasFrontmatter: boolean;
  closed: boolean;
  name?: string;
  description?: string;
  tools?: string[];
  body: string;
}

function parseScalar(value: string): string {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function parseToolList(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];

  const inner = trimmed.startsWith('[') && trimmed.endsWith(']')
    ? trimmed.slice(1, -1)
    : trimmed;

  return inner
    .split(',')
    .map((item) => parseScalar(item))
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseAgentFrontmatter(content: string): AgentFrontmatter {
  const lines = content.split('\n');

  if (lines[0]?.trim() !== '---') {
    return {
      hasFrontmatter: false,
      closed: false,
      body: content,
    };
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    return {
      hasFrontmatter: true,
      closed: false,
      body: '',
    };
  }

  const frontmatter: AgentFrontmatter = {
    hasFrontmatter: true,
    closed: true,
    body: lines.slice(closingIndex + 1).join('\n'),
  };

  let currentArrayKey: 'tools' | null = null;

  for (const rawLine of lines.slice(1, closingIndex)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const itemMatch = line.match(/^-\s+(.+)$/);
    if (itemMatch && currentArrayKey === 'tools') {
      frontmatter.tools ??= [];
      frontmatter.tools.push(parseScalar(itemMatch[1]));
      continue;
    }

    const keyMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!keyMatch) {
      currentArrayKey = null;
      continue;
    }

    const [, key, rawValue] = keyMatch;
    const value = rawValue.trim();
    currentArrayKey = null;

    if (key === 'name') {
      frontmatter.name = parseScalar(value);
      continue;
    }

    if (key === 'description') {
      frontmatter.description = parseScalar(value);
      continue;
    }

    if (key === 'tools') {
      currentArrayKey = 'tools';
      if (value) {
        frontmatter.tools = parseToolList(value);
      }
    }
  }

  return frontmatter;
}

function metadataDiagnostic(
  severity: Diagnostic['severity'],
  message: string,
): Diagnostic {
  return {
    severity,
    code: 'METADATA',
    message,
  };
}

const AGENT_NAME_PATTERN = /^[a-z]+(?:-[a-z]+)*$/;

export function validateAgentFrontmatter(filePath: string, rules: Rule[]): Diagnostic[] {
  if (!isClaudeAgentFilePath(filePath)) {
    return [];
  }

  const content = readFileSync(filePath, 'utf-8');
  const frontmatter = parseAgentFrontmatter(content);
  const diagnostics: Diagnostic[] = [];

  if (!frontmatter.hasFrontmatter) {
    diagnostics.push(
      metadataDiagnostic(
        'error',
        'Claude subagents should start with YAML frontmatter containing at least `name` and `description`.',
      ),
    );
    return diagnostics;
  }

  if (!frontmatter.closed) {
    diagnostics.push(
      metadataDiagnostic(
        'error',
        'This subagent has an unclosed YAML frontmatter block.',
      ),
    );
    return diagnostics;
  }

  if (!frontmatter.name) {
    diagnostics.push(
      metadataDiagnostic(
        'error',
        'Missing required `name` in subagent frontmatter.',
      ),
    );
  } else if (!AGENT_NAME_PATTERN.test(frontmatter.name)) {
    diagnostics.push(
      metadataDiagnostic(
        'warning',
        'Subagent `name` should use lowercase letters and hyphens to match Claude Code conventions.',
      ),
    );
  }

  if (!frontmatter.description) {
    diagnostics.push(
      metadataDiagnostic(
        'error',
        'Missing required `description` in subagent frontmatter.',
      ),
    );
  }

  if (frontmatter.body.trim().length === 0) {
    diagnostics.push(
      metadataDiagnostic(
        'error',
        'Subagent frontmatter is present, but the instruction body is empty.',
      ),
    );
  } else if (rules.length === 0) {
    diagnostics.push(
      metadataDiagnostic(
        'warning',
        'The subagent body does not contain clear actionable instructions. Add concrete role, trigger, or workflow guidance.',
      ),
    );
  }

  return diagnostics;
}
