import path from 'node:path';
import type { Rule } from './types.js';
import { extractInstructionFrontmatter } from './frontmatter.js';
import {
  isClaudeRulesFilePath,
  isCursorRulesFilePath,
  normalizeInstructionPath,
  resolveRulesBaseDir,
} from './instruction-paths.js';

export interface RuleApplicability {
  kind: 'path-scoped';
  patterns: string[];
  baseDir: string;
  source: 'cursor-globs' | 'cursor-directory' | 'claude-paths' | 'claude-directory';
}

function normalizeForMatching(filePath: string): string {
  return normalizeInstructionPath(path.resolve(filePath));
}

function isWorkspaceNested(baseDir: string, cwd?: string): boolean {
  if (!cwd) return false;

  const normalizedBase = normalizeForMatching(baseDir);
  const normalizedCwd = normalizeForMatching(cwd);
  return normalizedBase !== normalizedCwd;
}

export function getInstructionFileApplicability(
  filePath: string,
  content: string,
  cwd?: string,
): RuleApplicability | undefined {
  const { frontmatter } = extractInstructionFrontmatter(content);

  if (isCursorRulesFilePath(filePath)) {
    const baseDir = resolveRulesBaseDir(filePath, 'cursor');
    if (!baseDir) return undefined;

    if (frontmatter.alwaysApply === true) {
      return undefined;
    }

    if (frontmatter.globs.length > 0) {
      return {
        kind: 'path-scoped',
        patterns: frontmatter.globs,
        baseDir,
        source: 'cursor-globs',
      };
    }

    if (isWorkspaceNested(baseDir, cwd)) {
      return {
        kind: 'path-scoped',
        patterns: ['**'],
        baseDir,
        source: 'cursor-directory',
      };
    }

    return undefined;
  }

  if (isClaudeRulesFilePath(filePath)) {
    const baseDir = resolveRulesBaseDir(filePath, 'claude');
    if (!baseDir) return undefined;

    if (frontmatter.paths.length > 0) {
      return {
        kind: 'path-scoped',
        patterns: frontmatter.paths,
        baseDir,
        source: 'claude-paths',
      };
    }

    if (isWorkspaceNested(baseDir, cwd)) {
      return {
        kind: 'path-scoped',
        patterns: ['**'],
        baseDir,
        source: 'claude-directory',
      };
    }
  }

  return undefined;
}

export function applyRuleApplicability(
  rules: Rule[],
  applicability: RuleApplicability | undefined,
): Rule[] {
  if (!applicability) {
    return rules;
  }

  return rules.map((rule) => ({
    ...rule,
    applicability,
  }));
}

function expandBracePatterns(pattern: string): string[] {
  const match = pattern.match(/\{([^{}]+)\}/);
  if (!match || !match[1]) return [pattern];

  const [token] = match;
  return match[1]
    .split(',')
    .flatMap((part) => expandBracePatterns(pattern.replace(token, part.trim())));
}

function globToRegExp(pattern: string): RegExp {
  let regex = '^';

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];

    if (char === '*') {
      const next = pattern[i + 1];
      if (next === '*') {
        if (pattern[i + 2] === '/') {
          regex += '(?:.*/)?';
          i += 2;
        } else {
          regex += '.*';
          i++;
        }
      } else {
        regex += '[^/]*';
      }
      continue;
    }

    if (char === '?') {
      regex += '[^/]';
      continue;
    }

    if ('\\.[]{}()+-^$|'.includes(char)) {
      regex += `\\${char}`;
      continue;
    }

    regex += char;
  }

  regex += '$';
  return new RegExp(regex);
}

function resolveScopedPattern(applicability: RuleApplicability, pattern: string): string {
  return normalizeInstructionPath(path.resolve(applicability.baseDir, pattern));
}

function patternMatchesPath(pattern: string, filePath: string): boolean {
  const regex = globToRegExp(pattern);
  return regex.test(filePath);
}

function staticGlobPrefix(pattern: string): string {
  const wildcardIndex = pattern.search(/[*?{[]/);
  const staticPortion = wildcardIndex === -1 ? pattern : pattern.slice(0, wildcardIndex);
  const slashIndex = staticPortion.lastIndexOf('/');
  if (slashIndex === -1) return '';
  return staticPortion.slice(0, slashIndex + 1);
}

export function ruleAppliesToPath(
  rule: Rule,
  filePath: string,
  cwd?: string,
): boolean {
  const applicability = rule.applicability;
  if (!applicability) {
    return true;
  }

  const candidate = path.isAbsolute(filePath)
    ? normalizeInstructionPath(filePath)
    : cwd
      ? normalizeForMatching(path.join(cwd, filePath))
      : normalizeInstructionPath(filePath);

  return applicability.patterns.some((pattern) =>
    expandBracePatterns(resolveScopedPattern(applicability, pattern))
      .some((expanded) => patternMatchesPath(expanded, candidate))
  );
}

export function ruleAppliesToAnyPath(
  rule: Rule,
  filePaths: string[],
  cwd?: string,
): boolean {
  if (!rule.applicability) {
    return true;
  }

  return filePaths.some((filePath) => ruleAppliesToPath(rule, filePath, cwd));
}

export function rulesMayOverlap(ruleA: Rule, ruleB: Rule): boolean {
  if (!ruleA.applicability || !ruleB.applicability) {
    return true;
  }

  const resolvedA = ruleA.applicability.patterns.flatMap((pattern) =>
    expandBracePatterns(resolveScopedPattern(ruleA.applicability!, pattern)),
  );
  const resolvedB = ruleB.applicability.patterns.flatMap((pattern) =>
    expandBracePatterns(resolveScopedPattern(ruleB.applicability!, pattern)),
  );

  return resolvedA.some((patternA) => {
    const prefixA = staticGlobPrefix(patternA);
    return resolvedB.some((patternB) => {
      const prefixB = staticGlobPrefix(patternB);
      if (!prefixA || !prefixB) return true;
      return prefixA.startsWith(prefixB) || prefixB.startsWith(prefixA);
    });
  });
}
