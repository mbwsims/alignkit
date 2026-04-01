import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { Rule } from './types.js';
import { isClaudeMemoryFilePath, parseInstructionFile } from './auto-detect.js';

const MAX_IMPORT_DEPTH = 5;

export interface InstructionGraph {
  rootFile: string;
  entryFiles: string[];
  rules: Rule[];
  loadedFiles: string[];
  graphHash: string;
}

function stripInlineCode(text: string): string {
  return text.replace(/`[^`]*`/g, (match) => ' '.repeat(match.length));
}

function extractImports(content: string): string[] {
  const imports: string[] = [];
  const lines = content.split('\n');
  let inCodeFence = false;

  for (const line of lines) {
    if (/^```/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence) continue;

    const sanitized = stripInlineCode(line);
    const regex = /(?:^|[\s(])@([^\s]+)/g;
    for (const match of sanitized.matchAll(regex)) {
      const rawPath = (match[1] ?? '').replace(/[),.;:!?]+$/, '');
      if (rawPath.length > 0) {
        imports.push(rawPath);
      }
    }
  }

  return imports;
}

function resolveImportPath(fromFile: string, importPath: string): string {
  if (importPath.startsWith('~/')) {
    return path.join(homedir(), importPath.slice(2));
  }
  if (path.isAbsolute(importPath)) {
    return importPath;
  }
  return path.resolve(path.dirname(fromFile), importPath);
}

interface LoadedFile {
  filePath: string;
  content: string;
}

function buildInstructionGraph(rootFile: string, entryFiles: string[]): InstructionGraph {
  const loadedFiles: LoadedFile[] = [];
  const rules: Rule[] = [];
  const visited = new Set<string>();

  function visit(currentFile: string, depth: number): void {
    const resolved = path.resolve(currentFile);
    if (visited.has(resolved)) return;
    if (depth > MAX_IMPORT_DEPTH) return;
    if (!existsSync(resolved)) return;

    visited.add(resolved);

    const content = readFileSync(resolved, 'utf-8');
    loadedFiles.push({ filePath: resolved, content });
    rules.push(...parseInstructionFile(content, resolved));

    for (const importPath of extractImports(content)) {
      visit(resolveImportPath(resolved, importPath), depth + 1);
    }
  }

  for (const entryFile of entryFiles) {
    visit(entryFile, 0);
  }

  const graphHash = createHash('sha256')
    .update(
      loadedFiles
        .map((file) => `${file.filePath}\n${file.content}`)
        .join('\n---alignkit-import-boundary---\n'),
    )
    .digest('hex')
    .slice(0, 12);

  return {
    rootFile,
    entryFiles,
    rules,
    loadedFiles: loadedFiles.map((file) => file.filePath),
    graphHash,
  };
}

function resolveBoundaryDir(targetDir: string, cwd: string): string | null {
  const resolvedCwd = path.resolve(cwd);
  const relative = path.relative(resolvedCwd, targetDir);

  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolvedCwd;
  }

  return null;
}

function resolveEffectiveMemoryEntryFiles(filePath: string, cwd: string): string[] {
  const rootFile = path.resolve(filePath);
  // Model Claude's project memory stack within the current workspace rather
  // than implicitly pulling in parent-directory memories outside the repo.
  const boundaryDir = resolveBoundaryDir(path.dirname(rootFile), cwd);
  const directories: string[] = [];

  let currentDir = path.dirname(rootFile);
  while (true) {
    directories.push(currentDir);

    if (boundaryDir !== null && currentDir === boundaryDir) {
      break;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  const entryFiles: string[] = [];

  for (const dir of directories.reverse()) {
    const sharedFile = path.join(dir, 'CLAUDE.md');
    const localFile = path.join(dir, 'CLAUDE.local.md');

    if (existsSync(sharedFile)) {
      entryFiles.push(sharedFile);
    }
    if (existsSync(localFile)) {
      entryFiles.push(localFile);
    }
  }

  if (entryFiles.length === 0) {
    entryFiles.push(rootFile);
  }

  return Array.from(new Set(entryFiles.map((entry) => path.resolve(entry))));
}

export function loadInstructionGraph(filePath: string): InstructionGraph {
  const rootFile = path.resolve(filePath);
  return buildInstructionGraph(rootFile, [rootFile]);
}

export function loadEffectiveInstructionGraph(filePath: string, cwd: string): InstructionGraph {
  const rootFile = path.resolve(filePath);

  if (!isClaudeMemoryFilePath(rootFile)) {
    return loadInstructionGraph(rootFile);
  }

  return buildInstructionGraph(
    rootFile,
    resolveEffectiveMemoryEntryFiles(rootFile, cwd),
  );
}
