import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export interface ProjectContext {
  dependencies: string[];
  tsconfig: Record<string, unknown> | null;
  directoryTree: DirectoryEntry[];
}

export interface DirectoryEntry {
  path: string;
  fileCount: number;
  children?: DirectoryEntry[];
}

const IGNORED_DIRS = new Set(['node_modules', 'dist', '.git']);

function buildDirectoryTree(
  absDir: string,
  relPath: string,
  depth: number,
  maxDepth: number,
): DirectoryEntry[] {
  if (depth > maxDepth) return [];

  let entries: import('fs').Dirent<string>[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true, encoding: 'utf8' });
  } catch {
    return [];
  }

  const result: DirectoryEntry[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (IGNORED_DIRS.has(entry.name)) continue;

    const entryAbsPath = join(absDir, entry.name);
    const entryRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;

    // Count files directly in this directory
    let fileCount = 0;
    try {
      const children = readdirSync(entryAbsPath, { withFileTypes: true, encoding: 'utf8' });
      for (const child of children) {
        if (child.isFile()) fileCount++;
      }
    } catch {
      // ignore unreadable dirs
    }

    const dirEntry: DirectoryEntry = { path: entryRelPath, fileCount };

    if (depth < maxDepth) {
      const children = buildDirectoryTree(entryAbsPath, entryRelPath, depth + 1, maxDepth);
      if (children.length > 0) {
        dirEntry.children = children;
      }
    }

    result.push(dirEntry);
  }

  return result;
}

export function collectProjectContext(cwd: string): ProjectContext {
  // Read package.json dependencies
  let dependencies: string[] = [];
  try {
    const raw = readFileSync(join(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const deps = pkg['dependencies'] as Record<string, string> | undefined;
    const devDeps = pkg['devDependencies'] as Record<string, string> | undefined;
    dependencies = [
      ...Object.keys(deps ?? {}),
      ...Object.keys(devDeps ?? {}),
    ];
  } catch {
    // file not found or invalid JSON — use empty default
  }

  // Read tsconfig.json compilerOptions
  let tsconfig: Record<string, unknown> | null = null;
  try {
    const raw = readFileSync(join(cwd, 'tsconfig.json'), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const compilerOptions = parsed['compilerOptions'];
    if (compilerOptions && typeof compilerOptions === 'object' && !Array.isArray(compilerOptions)) {
      tsconfig = compilerOptions as Record<string, unknown>;
    }
  } catch {
    // file not found or invalid JSON — leave null
  }

  // Build directory tree up to depth 3
  const directoryTree = buildDirectoryTree(cwd, '', 1, 3);

  return { dependencies, tsconfig, directoryTree };
}
