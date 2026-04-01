import path from 'node:path';

export function normalizeInstructionPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function isClaudeMemoryFilePath(filePath: string): boolean {
  const basename = path.basename(filePath);
  return basename === 'CLAUDE.md' || basename === 'CLAUDE.local.md';
}

export function isCursorRulesFilePath(filePath: string): boolean {
  return normalizeInstructionPath(filePath).includes('/.cursor/rules/');
}

export function isClaudeRulesFilePath(filePath: string): boolean {
  return normalizeInstructionPath(filePath).includes('/.claude/rules/');
}

export function isClaudeAgentFilePath(filePath: string): boolean {
  return normalizeInstructionPath(filePath).includes('/.claude/agents/');
}

export function resolveRulesBaseDir(
  filePath: string,
  kind: 'cursor' | 'claude',
): string | null {
  const normalized = normalizeInstructionPath(path.resolve(filePath));
  const marker = kind === 'cursor' ? '/.cursor/rules/' : '/.claude/rules/';
  const markerIndex = normalized.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  const baseDir = normalized.slice(0, markerIndex) || path.parse(normalized).root;
  return path.resolve(baseDir);
}
