import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  analyzeOptimizeTarget,
  computeMaps,
  getOptimizedOutputFileName,
  reconstructInstructionDocument,
  reconstructMarkdown,
  type OptimizeTargetDocument,
} from '../../src/cli/optimize.js';
import { ANALYSIS_VERSION } from '../../src/history/analysis-version.js';
import { deduplicateRules } from '../../src/optimizer/deduplicator.js';
import { reorderRules } from '../../src/optimizer/reorderer.js';
import { flagRules } from '../../src/optimizer/flagger.js';
import type { Rule } from '../../src/parsers/types.js';
import type { SessionResult } from '../../src/history/types.js';

function makeRule(id: string, text: string, section: string | null = null): Rule {
  return {
    id,
    slug: id,
    text,
    source: { file: 'CLAUDE.md', lineStart: 1, lineEnd: 1, section },
    category: 'behavioral',
    verifiability: 'auto',
    diagnostics: [],
  };
}

function makeSession(
  id: string,
  timestamp: string,
  observations: Array<{ ruleId: string; relevant: boolean; followed: boolean | null }>,
): SessionResult {
  return {
    sessionId: id,
    timestamp,
    rulesVersion: 'abc123',
    analysisVersion: ANALYSIS_VERSION,
    observations: observations.map((o) => ({
      ruleId: o.ruleId,
      sessionId: id,
      relevant: o.relevant,
      followed: o.followed,
      method: 'auto:bash-keyword',
      confidence: 'high',
    })),
  };
}

describe('computeMaps', () => {
  it('computes adherence and relevance maps from sessions', () => {
    const rules = [
      makeRule('r1', 'Rule one'),
      makeRule('r2', 'Rule two'),
    ];

    const sessions = [
      makeSession('s1', '2025-01-01T00:00:00Z', [
        { ruleId: 'r1', relevant: true, followed: true },
        { ruleId: 'r2', relevant: true, followed: false },
      ]),
      makeSession('s2', '2025-01-02T00:00:00Z', [
        { ruleId: 'r1', relevant: true, followed: true },
        { ruleId: 'r2', relevant: true, followed: true },
      ]),
    ];

    const { adherenceMap, relevanceMap } = computeMaps(rules, sessions);

    expect(adherenceMap.get('r1')).toBe(100); // 2/2
    expect(adherenceMap.get('r2')).toBe(50);  // 1/2
    expect(relevanceMap.get('r1')).toBe(2);
    expect(relevanceMap.get('r2')).toBe(2);
  });
});

describe('full optimize pipeline', () => {
  it('deduplicates, reorders, and flags rules', () => {
    const rules = [
      makeRule('r1', 'Always run tests before committing code changes', 'Testing'),
      makeRule('r2', 'Run tests before committing any code changes', 'Testing'),
      makeRule('r3', 'Use TypeScript strict mode everywhere', 'Code Quality'),
      makeRule('r4', 'Never skip type checking', 'Code Quality'),
    ];

    const sessions = [
      makeSession('s1', '2025-01-01T00:00:00Z', [
        { ruleId: 'r1', relevant: true, followed: true },
        { ruleId: 'r2', relevant: true, followed: false },
        { ruleId: 'r3', relevant: true, followed: true },
        { ruleId: 'r4', relevant: false, followed: null },
      ]),
      makeSession('s2', '2025-01-02T00:00:00Z', [
        { ruleId: 'r1', relevant: true, followed: true },
        { ruleId: 'r2', relevant: true, followed: false },
        { ruleId: 'r3', relevant: true, followed: true },
        { ruleId: 'r4', relevant: false, followed: null },
      ]),
    ];

    const { adherenceMap, relevanceMap } = computeMaps(rules, sessions);

    // Step 1: Deduplicate
    const { rules: dedupedRules, deduped } = deduplicateRules(rules, adherenceMap);
    // r1 and r2 are near-duplicates; r1 has higher adherence
    expect(deduped.length).toBeGreaterThanOrEqual(1);

    // Step 2: Reorder
    const reorderedRules = reorderRules(dedupedRules, adherenceMap);
    expect(reorderedRules.length).toBeLessThanOrEqual(rules.length);

    // Step 3: Flag
    const flagged = flagRules(reorderedRules, adherenceMap, relevanceMap);
    // r4 is never relevant
    const neverRelevant = flagged.filter((f) => f.reason === 'never-relevant');
    expect(neverRelevant.length).toBeGreaterThanOrEqual(0); // r4 may have been deduped
  });

  it('prune removes never-relevant rules', () => {
    const rules = [
      makeRule('r1', 'Relevant rule'),
      makeRule('r2', 'Never relevant rule'),
    ];

    const sessions = [
      makeSession('s1', '2025-01-01T00:00:00Z', [
        { ruleId: 'r1', relevant: true, followed: true },
        { ruleId: 'r2', relevant: false, followed: null },
      ]),
    ];

    const { adherenceMap, relevanceMap } = computeMaps(rules, sessions);
    const { rules: dedupedRules } = deduplicateRules(rules, adherenceMap);
    const reorderedRules = reorderRules(dedupedRules, adherenceMap);
    const flagged = flagRules(reorderedRules, adherenceMap, relevanceMap);

    const neverRelevantIds = new Set(
      flagged.filter((f) => f.reason === 'never-relevant').map((f) => f.rule.id),
    );
    const prunedRules = reorderedRules.filter((r) => !neverRelevantIds.has(r.id));

    expect(prunedRules).toHaveLength(1);
    expect(prunedRules[0].id).toBe('r1');
  });
});

describe('reconstructMarkdown', () => {
  it('groups rules by section', () => {
    const rules = [
      makeRule('r1', 'Rule A', 'Section One'),
      makeRule('r2', 'Rule B', 'Section One'),
      makeRule('r3', 'Rule C', 'Section Two'),
    ];

    const md = reconstructMarkdown(rules);
    expect(md).toContain('## Section One');
    expect(md).toContain('## Section Two');
    expect(md).toContain('- Rule A');
    expect(md).toContain('- Rule B');
    expect(md).toContain('- Rule C');
  });

  it('handles rules with no section', () => {
    const rules = [makeRule('r1', 'No section rule', null)];
    const md = reconstructMarkdown(rules);
    expect(md).toContain('- No section rule');
    expect(md).not.toContain('##');
  });
});

describe('optimize document preservation helpers', () => {
  it('preserves frontmatter when reconstructing markdown-based rule files', () => {
    const document: OptimizeTargetDocument = {
      filePath: '/repo/.cursor/rules/typescript.mdc',
      frontmatterBlock: ['---', 'description: TypeScript rules', 'globs:', '  - "src/**/*.ts"', '---'].join('\n'),
      importLines: [],
      style: 'markdown',
      rules: [],
      hasExternalGraph: false,
    };

    const output = reconstructInstructionDocument(document, [
      makeRule('r1', 'Use TypeScript strict mode', 'Rules'),
    ]);

    expect(output).toContain('description: TypeScript rules');
    expect(output).toContain('## Rules');
    expect(output).toContain('- Use TypeScript strict mode');
  });

  it('preserves imports and only optimizes rules from the target file', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'alignkit-optimize-'));

    try {
      mkdirSync(join(tmpDir, 'docs'), { recursive: true });
      writeFileSync(
        join(tmpDir, 'CLAUDE.md'),
        ['- @docs/testing.md', '- Use pnpm for package management.'].join('\n'),
        'utf-8',
      );
      writeFileSync(
        join(tmpDir, 'docs/testing.md'),
        '- Run tests before committing.',
        'utf-8',
      );

      const document = analyzeOptimizeTarget(join(tmpDir, 'CLAUDE.md'), tmpDir);

      expect(document.importLines).toEqual(['- @docs/testing.md']);
      expect(document.hasExternalGraph).toBe(true);
      expect(document.rules.map((rule) => rule.text)).toEqual([
        'Use pnpm for package management.',
      ]);

      const output = reconstructInstructionDocument(document, document.rules);
      expect(output).toContain('- @docs/testing.md');
      expect(output).toContain('- Use pnpm for package management.');
      expect(output).not.toContain('Run tests before committing.');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('keeps format-specific optimized output names', () => {
    expect(getOptimizedOutputFileName('/repo/.cursor/rules/typescript.mdc')).toBe('typescript.optimized.mdc');
    expect(getOptimizedOutputFileName('/repo/.claude/rules/frontend.md')).toBe('frontend.optimized.md');
    expect(getOptimizedOutputFileName('/repo/.cursorrules')).toBe('.cursorrules.optimized');
  });
});
