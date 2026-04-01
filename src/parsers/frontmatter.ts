export interface InstructionFrontmatter {
  description?: string;
  globs: string[];
  paths: string[];
  alwaysApply?: boolean;
}

function parseScalar(value: string): string | boolean {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1);
  }

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  return trimmed;
}

function parseInlineArray(value: string): string[] {
  const inner = value.trim().slice(1, -1).trim();
  if (!inner) return [];

  return inner
    .split(',')
    .map((item) => parseScalar(item))
    .filter((item): item is string => typeof item === 'string');
}

export function extractInstructionFrontmatter(content: string): {
  frontmatter: InstructionFrontmatter;
  bodyPreservingLines: string;
} {
  const lines = content.split('\n');
  const empty = { description: undefined, globs: [], paths: [], alwaysApply: undefined };

  if (lines[0]?.trim() !== '---') {
    return {
      frontmatter: empty,
      bodyPreservingLines: content,
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
      frontmatter: empty,
      bodyPreservingLines: content,
    };
  }

  const frontmatter: InstructionFrontmatter = {
    description: undefined,
    globs: [],
    paths: [],
    alwaysApply: undefined,
  };

  let currentArrayKey: 'globs' | 'paths' | null = null;

  for (const rawLine of lines.slice(1, closingIndex)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const itemMatch = line.match(/^-\s+(.+)$/);
    if (itemMatch && currentArrayKey) {
      const parsed = parseScalar(itemMatch[1]);
      if (typeof parsed === 'string') {
        frontmatter[currentArrayKey].push(parsed);
      }
      continue;
    }

    const keyMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!keyMatch) {
      currentArrayKey = null;
      continue;
    }

    const [, key, rawValue] = keyMatch;
    const value = rawValue.trim();

    if (key === 'globs' || key === 'paths') {
      currentArrayKey = key;
      if (!value) continue;
      if (value.startsWith('[') && value.endsWith(']')) {
        frontmatter[key].push(...parseInlineArray(value));
      } else {
        const parsed = parseScalar(value);
        if (typeof parsed === 'string') {
          frontmatter[key].push(parsed);
        }
      }
      continue;
    }

    currentArrayKey = null;

    if (key === 'description') {
      const parsed = parseScalar(value);
      if (typeof parsed === 'string') {
        frontmatter.description = parsed;
      }
      continue;
    }

    if (key === 'alwaysApply') {
      const parsed = parseScalar(value);
      if (typeof parsed === 'boolean') {
        frontmatter.alwaysApply = parsed;
      }
    }
  }

  const preservedPrefix = lines
    .slice(0, closingIndex + 1)
    .map(() => '')
    .join('\n');

  return {
    frontmatter,
    bodyPreservingLines: preservedPrefix + '\n' + lines.slice(closingIndex + 1).join('\n'),
  };
}
