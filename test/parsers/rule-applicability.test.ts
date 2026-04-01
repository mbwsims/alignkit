import { describe, it, expect } from 'vitest';
import {
  applyRuleApplicability,
  getInstructionFileApplicability,
  ruleAppliesToAnyPath,
  ruleAppliesToPath,
  rulesMayOverlap,
  type RuleApplicability,
} from '../../src/parsers/rule-applicability.js';
import type { Rule } from '../../src/parsers/types.js';

function makeRule(text: string, applicability?: RuleApplicability): Rule {
  return {
    id: `rule-${text}`,
    slug: `slug-${text}`,
    text,
    source: {
      file: '/repo/CLAUDE.md',
      lineStart: 1,
      lineEnd: 1,
      section: null,
    },
    category: 'tool-constraint',
    verifiability: 'auto',
    diagnostics: [],
    applicability,
  };
}

describe('getInstructionFileApplicability', () => {
  it('reads Cursor globs frontmatter', () => {
    const applicability = getInstructionFileApplicability(
      '/repo/.cursor/rules/typescript.mdc',
      [
        '---',
        'description: TypeScript rules',
        'globs:',
        '  - "src/**/*.ts"',
        'alwaysApply: false',
        '---',
        '',
        '- Use TypeScript strict mode.',
      ].join('\n'),
      '/repo',
    );

    expect(applicability).toEqual({
      kind: 'path-scoped',
      patterns: ['src/**/*.ts'],
      baseDir: '/repo',
      source: 'cursor-globs',
    });
  });

  it('reads Claude paths frontmatter', () => {
    const applicability = getInstructionFileApplicability(
      '/repo/.claude/rules/frontend.md',
      [
        '---',
        'description: Frontend rules',
        'paths:',
        '  - "apps/web/**"',
        '  - "packages/ui/**"',
        '---',
        '',
        '- Use React components.',
      ].join('\n'),
      '/repo',
    );

    expect(applicability).toEqual({
      kind: 'path-scoped',
      patterns: ['apps/web/**', 'packages/ui/**'],
      baseDir: '/repo',
      source: 'claude-paths',
    });
  });

  it('infers directory scope for nested Cursor rules without globs', () => {
    const applicability = getInstructionFileApplicability(
      '/repo/packages/api/.cursor/rules/local.mdc',
      '- Use package-local tooling.',
      '/repo',
    );

    expect(applicability).toEqual({
      kind: 'path-scoped',
      patterns: ['**'],
      baseDir: '/repo/packages/api',
      source: 'cursor-directory',
    });
  });
});

describe('rule path matching', () => {
  const scopedRule = makeRule('Use pnpm.', {
    kind: 'path-scoped',
    patterns: ['src/**/*.{ts,tsx}'],
    baseDir: '/repo',
    source: 'cursor-globs',
  });

  it('matches brace-expanded globs', () => {
    expect(ruleAppliesToPath(scopedRule, '/repo/src/app.ts', '/repo')).toBe(true);
    expect(ruleAppliesToPath(scopedRule, '/repo/src/app.tsx', '/repo')).toBe(true);
    expect(ruleAppliesToPath(scopedRule, '/repo/src/app.js', '/repo')).toBe(false);
  });

  it('matches any touched file in a session', () => {
    expect(
      ruleAppliesToAnyPath(scopedRule, ['/repo/README.md', '/repo/src/app.tsx'], '/repo'),
    ).toBe(true);
  });
});

describe('rulesMayOverlap', () => {
  it('treats different directory scopes as non-overlapping', () => {
    const frontendRule = makeRule(
      'Use React components.',
      { kind: 'path-scoped', patterns: ['frontend/**'], baseDir: '/repo', source: 'claude-paths' },
    );
    const backendRule = makeRule(
      'Use Fastify handlers.',
      { kind: 'path-scoped', patterns: ['backend/**'], baseDir: '/repo', source: 'claude-paths' },
    );

    expect(rulesMayOverlap(frontendRule, backendRule)).toBe(false);
  });

  it('treats global rules as overlapping with scoped rules', () => {
    const globalRule = makeRule('Never commit secrets.');
    const frontendRule = makeRule(
      'Use React components.',
      { kind: 'path-scoped', patterns: ['frontend/**'], baseDir: '/repo', source: 'claude-paths' },
    );

    expect(rulesMayOverlap(globalRule, frontendRule)).toBe(true);
  });
});

describe('applyRuleApplicability', () => {
  it('attaches applicability to all parsed rules', () => {
    const applicability: RuleApplicability = {
      kind: 'path-scoped',
      patterns: ['src/**'],
      baseDir: '/repo',
      source: 'cursor-globs',
    };

    const rules = applyRuleApplicability(
      [makeRule('Use pnpm.'), makeRule('Write tests.')],
      applicability,
    );

    expect(rules.every((rule) => rule.applicability?.source === 'cursor-globs')).toBe(true);
  });
});
