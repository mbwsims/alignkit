import path from 'node:path';
import { globbySync } from 'globby';
import type { Rule } from './types.js';
import { parseClaudeMd } from './claude-md.js';
import { parseClaudeRules } from './claude-rules.js';
import { parseAgentsMd } from './agents-md.js';
import { parseCursorrules } from './cursorrules.js';
import {
  isClaudeMemoryFilePath,
  isClaudeRulesFilePath,
  isCursorRulesFilePath,
} from './instruction-paths.js';

export interface DiscoveredFile {
  absolutePath: string;
  relativePath: string;
  isRoot: boolean;
}

const IGNORE_PATTERNS = ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/.claude/worktrees/**'];

const ROOT_PRIORITY: Record<string, number> = {
  'CLAUDE.md': 0,
  'CLAUDE.local.md': 1,
  '.cursorrules': 2,
  'AGENTS.md': 3,
  'rules': 4, // legacy .cursor/rules file
};

function getRootPriority(relativePath: string): number {
  const basename = path.basename(relativePath);
  const priority = ROOT_PRIORITY[basename];
  return priority !== undefined ? priority : 99;
}

export function discoverInstructionFiles(cwd: string): DiscoveredFile[] {
  const patterns = [
    '**/CLAUDE.md',
    '**/CLAUDE.local.md',
    '**/.claude/rules/**/*.md',
    '**/.claude/rules/**/*.mdc',
    '**/AGENTS.md',
    '**/.cursorrules',
    '**/.cursor/rules',
    '**/.cursor/rules/**/*.md',
    '**/.cursor/rules/**/*.mdc',
  ];

  const found = globbySync(patterns, {
    cwd,
    ignore: IGNORE_PATTERNS,
    dot: true,
    absolute: false,
  });

  const files: DiscoveredFile[] = found.map((relativePath) => ({
    absolutePath: path.join(cwd, relativePath),
    relativePath,
    isRoot: !relativePath.includes('/'),
  }));

  files.sort((a, b) => {
    // Root files come before nested files
    if (a.isRoot && !b.isRoot) return -1;
    if (!a.isRoot && b.isRoot) return 1;

    // Both root: sort by priority
    if (a.isRoot && b.isRoot) {
      return getRootPriority(a.relativePath) - getRootPriority(b.relativePath);
    }

    // Both nested: sort alphabetically
    return a.relativePath.localeCompare(b.relativePath);
  });

  return files;
}

export function discoverInstructionTargets(cwd: string): DiscoveredFile[] {
  const discovered = discoverInstructionFiles(cwd);
  const primaryClaudeFileByDir = new Map<string, string>();
  const hasClaudeMemoryTargets = discovered.some((file) => isClaudeMemoryFilePath(file.absolutePath));

  for (const file of discovered) {
    if (!isClaudeMemoryFilePath(file.absolutePath)) continue;

    const dirKey = path.dirname(file.relativePath);
    const existing = primaryClaudeFileByDir.get(dirKey);

    if (
      existing === undefined ||
      getRootPriority(file.relativePath) < getRootPriority(existing)
    ) {
      primaryClaudeFileByDir.set(dirKey, file.relativePath);
    }
  }

  return discovered.filter((file) => {
    if (hasClaudeMemoryTargets && isClaudeRulesFilePath(file.absolutePath)) {
      return false;
    }
    if (!isClaudeMemoryFilePath(file.absolutePath)) return true;
    const dirKey = path.dirname(file.relativePath);
    return primaryClaudeFileByDir.get(dirKey) === file.relativePath;
  });
}

export function parseInstructionFile(content: string, filePath: string, cwd?: string): Rule[] {
  const basename = path.basename(filePath);

  switch (basename) {
    case 'CLAUDE.md':
    case 'CLAUDE.local.md':
      return parseClaudeMd(content, filePath);
    case 'AGENTS.md':
      return parseAgentsMd(content, filePath);
    case '.cursorrules':
    case 'rules':
      return parseCursorrules(content, filePath, cwd);
    default:
      if (isClaudeRulesFilePath(filePath)) {
        return parseClaudeRules(content, filePath, cwd);
      }
      if (isCursorRulesFilePath(filePath) || basename.endsWith('.mdc')) {
        return parseCursorrules(content, filePath, cwd);
      }
      return parseClaudeMd(content, filePath);
  }
}
