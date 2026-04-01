import { describe, it, expect } from 'vitest';
import { advisePlacement } from '../../src/analyzers/placement-advisor.js';
import { detectLinterRules } from '../../src/analyzers/linter-rule-detector.js';
import type { Rule } from '../../src/parsers/types.js';

function makeRule(
  text: string,
  overrides?: Partial<Rule>,
): Rule {
  return {
    id: 'rule-1',
    slug: 'rule-1',
    text,
    source: {
      file: '/repo/CLAUDE.md',
      lineStart: 1,
      lineEnd: 1,
      section: null,
    },
    category: 'behavioral',
    verifiability: 'auto',
    diagnostics: [],
    ...overrides,
  };
}

describe('advisePlacement', () => {
  it('recommends path-scoped rules for root memory rules with explicit path fragments', () => {
    const [result] = advisePlacement(
      [makeRule('For `apps/web/**`, use React Server Components by default.')],
      '/repo',
    );

    const diagnostic = result.diagnostics.find((d) => d.code === 'PLACEMENT');
    expect(diagnostic?.placement?.target).toBe('scoped-rule');
    expect(diagnostic?.message).toContain('.claude/rules/');
  });

  it('recommends hooks for deterministic automation rules', () => {
    const [result] = advisePlacement(
      [makeRule('After every file edit, run eslint --fix on the changed file.')],
      '/repo',
    );

    const diagnostic = result.diagnostics.find((d) => d.code === 'PLACEMENT');
    expect(diagnostic?.placement).toEqual({
      target: 'hook',
      confidence: 'high',
      detail: 'PostToolUse',
    });
  });

  it('recommends subagents for reusable multi-step task workflows', () => {
    const [result] = advisePlacement(
      [makeRule('When debugging production issues, first capture logs, then isolate a minimal reproduction, then write a failing test, then apply the smallest safe fix.')],
      '/repo',
    );

    const diagnostic = result.diagnostics.find((d) => d.code === 'PLACEMENT');
    expect(diagnostic?.placement?.target).toBe('subagent');
    expect(diagnostic?.message).toContain('.claude/agents/');
  });

  it('does not recommend subagents for rules already defined inside .claude/agents', () => {
    const [result] = advisePlacement(
      [
        makeRule(
          'When debugging production issues, first capture logs, then isolate a minimal reproduction, then write a failing test, then apply the smallest safe fix.',
          {
            source: {
              file: '/repo/.claude/agents/debugger.md',
              lineStart: 8,
              lineEnd: 8,
              section: null,
            },
          },
        ),
      ],
      '/repo',
    );

    expect(result.diagnostics.some((d) => d.code === 'PLACEMENT')).toBe(false);
  });

  it('does not recommend hooks or subagents for rules already defined inside skills', () => {
    const [result] = advisePlacement(
      [
        makeRule(
          'When debugging production issues, first capture logs, then isolate a minimal reproduction, then write a failing test, then apply the smallest safe fix.',
          {
            source: {
              file: '/repo/.claude/skills/debug-workflow/SKILL.md',
              lineStart: 8,
              lineEnd: 8,
              section: null,
            },
          },
        ),
      ],
      '/repo',
    );

    expect(result.diagnostics.some((d) => d.code === 'PLACEMENT')).toBe(false);
  });

  it('does not recommend scoped rules for already scoped instructions', () => {
    const [result] = advisePlacement(
      [
        makeRule('For `apps/web/**`, use React Server Components by default.', {
          applicability: {
            kind: 'path-scoped',
            patterns: ['apps/web/**'],
            baseDir: '/repo',
            source: 'claude-paths',
          },
        }),
      ],
      '/repo',
    );

    expect(result.diagnostics.some((d) => d.code === 'PLACEMENT')).toBe(false);
  });

  it('skips placement advice when a linter-placement diagnostic already exists', () => {
    const [result] = advisePlacement(
      detectLinterRules([makeRule('Always use semicolons in JavaScript files.')]),
      '/repo',
    );

    expect(result.diagnostics.filter((d) => d.code === 'PLACEMENT')).toHaveLength(0);
    expect(result.diagnostics.find((d) => d.code === 'LINTER_JOB')?.placement?.target).toBe('tool-config');
  });
});
