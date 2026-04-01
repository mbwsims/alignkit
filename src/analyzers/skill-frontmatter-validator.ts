import path from 'node:path';
import { readFileSync } from 'node:fs';
import { isClaudeSkillFilePath } from '../parsers/instruction-paths.js';
import type { Diagnostic, Rule } from '../parsers/types.js';

interface SkillFrontmatter {
  hasFrontmatter: boolean;
  closed: boolean;
  name?: string;
  description?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  context?: string;
  agent?: string;
  body: string;
  invalidBooleanKeys: string[];
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

function parseBoolean(value: string): boolean | null {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return null;
}

function parseSkillFrontmatter(content: string): SkillFrontmatter {
  const lines = content.split('\n');

  if (lines[0]?.trim() !== '---') {
    return {
      hasFrontmatter: false,
      closed: false,
      body: content,
      invalidBooleanKeys: [],
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
      invalidBooleanKeys: [],
    };
  }

  const frontmatter: SkillFrontmatter = {
    hasFrontmatter: true,
    closed: true,
    body: lines.slice(closingIndex + 1).join('\n'),
    invalidBooleanKeys: [],
  };

  for (const rawLine of lines.slice(1, closingIndex)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const keyMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!keyMatch) {
      continue;
    }

    const [, key, rawValue] = keyMatch;
    const value = rawValue.trim();

    switch (key) {
      case 'name':
        frontmatter.name = parseScalar(value);
        break;
      case 'description':
        frontmatter.description = parseScalar(value);
        break;
      case 'disable-model-invocation': {
        const parsed = parseBoolean(value);
        if (parsed === null) {
          frontmatter.invalidBooleanKeys.push(key);
        } else {
          frontmatter.disableModelInvocation = parsed;
        }
        break;
      }
      case 'user-invocable': {
        const parsed = parseBoolean(value);
        if (parsed === null) {
          frontmatter.invalidBooleanKeys.push(key);
        } else {
          frontmatter.userInvocable = parsed;
        }
        break;
      }
      case 'context':
        frontmatter.context = parseScalar(value);
        break;
      case 'agent':
        frontmatter.agent = parseScalar(value);
        break;
      default:
        break;
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

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_NAME_MAX_LENGTH = 64;
const DESCRIPTION_RECOMMENDED_MAX = 250;

export function validateSkillFrontmatter(filePath: string, rules: Rule[]): Diagnostic[] {
  if (!isClaudeSkillFilePath(filePath)) {
    return [];
  }

  const content = readFileSync(filePath, 'utf-8');
  const frontmatter = parseSkillFrontmatter(content);
  const diagnostics: Diagnostic[] = [];

  if (!frontmatter.hasFrontmatter) {
    diagnostics.push(
      metadataDiagnostic(
        'warning',
        'Add YAML frontmatter to this skill, especially `description`, so Claude can discover when to invoke it.',
      ),
    );
  } else if (!frontmatter.closed) {
    diagnostics.push(
      metadataDiagnostic(
        'error',
        'This skill has an unclosed YAML frontmatter block.',
      ),
    );
    return diagnostics;
  }

  const effectiveName = frontmatter.name ?? path.basename(path.dirname(filePath));
  if (!SKILL_NAME_PATTERN.test(effectiveName)) {
    diagnostics.push(
      metadataDiagnostic(
        'warning',
        'Skill names should use lowercase letters, numbers, and hyphens to match Claude Code conventions.',
      ),
    );
  } else if (effectiveName.length > SKILL_NAME_MAX_LENGTH) {
    diagnostics.push(
      metadataDiagnostic(
        'warning',
        `Skill names should stay under ${SKILL_NAME_MAX_LENGTH} characters.`,
      ),
    );
  }

  if (!frontmatter.description) {
    diagnostics.push(
      metadataDiagnostic(
        'warning',
        'Add a `description` so Claude knows when to load this skill automatically.',
      ),
    );
  } else if (frontmatter.description.length > DESCRIPTION_RECOMMENDED_MAX) {
    diagnostics.push(
      metadataDiagnostic(
        'warning',
        `Skill descriptions over ${DESCRIPTION_RECOMMENDED_MAX} characters may be truncated in Claude’s skill listing.`,
      ),
    );
  }

  for (const key of frontmatter.invalidBooleanKeys) {
    diagnostics.push(
      metadataDiagnostic(
        'warning',
        `\`${key}\` should be set to \`true\` or \`false\`.`,
      ),
    );
  }

  if (frontmatter.context !== undefined && frontmatter.context !== 'fork') {
    diagnostics.push(
      metadataDiagnostic(
        'warning',
        'Skill `context` should be `fork` when you want the skill to run in a subagent context.',
      ),
    );
  }

  if (frontmatter.agent && frontmatter.context !== 'fork') {
    diagnostics.push(
      metadataDiagnostic(
        'warning',
        'Skill `agent` only applies when `context: fork` is set.',
      ),
    );
  }

  if (frontmatter.body.trim().length === 0) {
    diagnostics.push(
      metadataDiagnostic(
        'error',
        'Skill frontmatter is present, but the instruction body is empty.',
      ),
    );
  } else if (rules.length === 0) {
    diagnostics.push(
      metadataDiagnostic(
        'warning',
        'The skill body does not contain clear actionable instructions. Add concrete workflow, convention, or reference guidance.',
      ),
    );
  }

  return diagnostics;
}
