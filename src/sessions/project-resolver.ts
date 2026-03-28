import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Encode a CWD path into the directory name format used by Claude Code.
 * Every `/` is replaced with `-`.
 * e.g. `/Users/msims/Documents` → `-Users-msims-Documents`
 */
export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

/**
 * Resolve a CWD to the corresponding `~/.claude/projects/` subdirectory.
 *
 * Strategy:
 * 1. Direct match: encode CWD and check if the directory exists.
 * 2. Fallback: scan all subdirectories for sessions-index.json files,
 *    look for entries where projectPath matches CWD.
 * 3. Return null if no match found.
 */
export function resolveProjectDir(cwd: string, claudeDir?: string): string | null {
  const baseDir = claudeDir ?? join(homedir(), '.claude', 'projects');

  if (!existsSync(baseDir)) {
    return null;
  }

  // Strategy 1: direct match via path encoding
  const encoded = encodeProjectPath(cwd);
  const directPath = join(baseDir, encoded);
  if (existsSync(directPath)) {
    return directPath;
  }

  // Strategy 2: scan for sessions-index.json with matching projectPath
  let entries: string[];
  try {
    entries = readdirSync(baseDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return null;
  }

  for (const dirName of entries) {
    const indexPath = join(baseDir, dirName, 'sessions-index.json');
    if (!existsSync(indexPath)) {
      continue;
    }

    try {
      const indexData = JSON.parse(readFileSync(indexPath, 'utf8')) as {
        entries?: Array<{ projectPath?: string }>;
      };

      if (
        indexData.entries?.some(
          (entry) => entry.projectPath === cwd,
        )
      ) {
        return join(baseDir, dirName);
      }
    } catch {
      // Skip malformed index files
      continue;
    }
  }

  return null;
}
