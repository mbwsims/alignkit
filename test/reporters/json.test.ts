import { describe, it, expect } from 'vitest';
import { JsonReporter } from '../../src/reporters/json.js';
import { makeRule } from '../analyzers/helpers.js';
import type { LintResult, DeepAnalysisResult } from '../../src/analyzers/types.js';
import type { Diagnostic } from '../../src/parsers/types.js';

function makeLintResult(overrides?: Partial<LintResult>): LintResult {
  return {
    file: 'CLAUDE.md',
    rules: [],
    fileDiagnostics: [],
    tokenAnalysis: {
      tokenCount: 500,
      contextWindowPercent: 2.5,
      overBudget: false,
      budgetThreshold: 20000,
    },
    discoveredFiles: ['CLAUDE.md'],
    ...overrides,
  };
}

describe('JsonReporter', () => {
  it('outputs valid JSON', () => {
    const reporter = new JsonReporter();
    const result = makeLintResult();
    const output = reporter.report(result);
    expect(() => JSON.parse(output)).not.toThrow();
  });

  it('includes ruleCount matching the rules array length', () => {
    const reporter = new JsonReporter();
    const rules = [makeRule('Always use pnpm'), makeRule('Never commit secrets')];
    const result = makeLintResult({ rules });
    const output = JSON.parse(reporter.report(result));
    expect(output.ruleCount).toBe(2);
  });

  it('includes tokenAnalysis', () => {
    const reporter = new JsonReporter();
    const tokenAnalysis = {
      tokenCount: 1234,
      contextWindowPercent: 6.17,
      overBudget: false,
      budgetThreshold: 20000,
    };
    const result = makeLintResult({ tokenAnalysis });
    const output = JSON.parse(reporter.report(result));
    expect(output.tokenAnalysis).toEqual(tokenAnalysis);
  });

  it('includes diagnostics array extracted from all rules', () => {
    const reporter = new JsonReporter();
    const diag1: Diagnostic = { severity: 'warning', code: 'VAGUE', message: 'Rule is vague' };
    const diag2: Diagnostic = { severity: 'error', code: 'CONFLICT', message: 'Conflicts with rule X' };
    const rule1 = { ...makeRule('Use pnpm'), diagnostics: [diag1] };
    const rule2 = { ...makeRule('Never commit'), diagnostics: [diag2] };
    const result = makeLintResult({ rules: [rule1, rule2] });
    const output = JSON.parse(reporter.report(result));
    expect(output.diagnostics).toHaveLength(2);
    expect(output.diagnostics[0].code).toBe('VAGUE');
    expect(output.diagnostics[1].code).toBe('CONFLICT');
  });

  it('adds ruleSlug and ruleText to each extracted diagnostic', () => {
    const reporter = new JsonReporter();
    const diag: Diagnostic = { severity: 'warning', code: 'VAGUE', message: 'Too vague' };
    const rule = { ...makeRule('Always use pnpm for installs'), diagnostics: [diag] };
    const result = makeLintResult({ rules: [rule] });
    const output = JSON.parse(reporter.report(result));
    expect(output.diagnostics[0].ruleSlug).toBe(rule.slug);
    expect(output.diagnostics[0].ruleText).toBe(rule.text);
  });

  it('includes discoveredFiles', () => {
    const reporter = new JsonReporter();
    const discoveredFiles = ['CLAUDE.md', '.cursor/rules/base.md'];
    const result = makeLintResult({ discoveredFiles });
    const output = JSON.parse(reporter.report(result));
    expect(output.discoveredFiles).toEqual(discoveredFiles);
  });

  it('includes fileDiagnostics', () => {
    const reporter = new JsonReporter();
    const fileDiagnostics = [
      { severity: 'error', code: 'METADATA', message: 'Missing required `description` in subagent frontmatter.' },
    ];
    const result = makeLintResult({ fileDiagnostics });
    const output = JSON.parse(reporter.report(result));
    expect(output.fileDiagnostics).toEqual(fileDiagnostics);
  });

  it('includes rules array with mapped fields', () => {
    const reporter = new JsonReporter();
    const rule = makeRule('Use pnpm for all package operations');
    const result = makeLintResult({ rules: [rule] });
    const output = JSON.parse(reporter.report(result));
    expect(output.rules).toHaveLength(1);
    const r = output.rules[0];
    expect(r.id).toBe(rule.id);
    expect(r.slug).toBe(rule.slug);
    expect(r.text).toBe(rule.text);
    expect(r.category).toBe(rule.category);
    expect(r.verifiability).toBe(rule.verifiability);
    expect(r.source).toBeDefined();
    expect(r.diagnosticCount).toBe(0);
  });

  it('includes deepAnalysis field with correct structure when deepAnalysis is present', () => {
    const reporter = new JsonReporter();
    const rule = makeRule('Always be helpful');
    const deepAnalysis: DeepAnalysisResult = {
      effectiveness: [
        {
          ruleId: rule.id,
          level: 'LOW',
          reason: 'Too vague to be actionable',
          suggestedRewrite: 'Use specific tone guidelines',
        },
      ],
      coverageGaps: [
        {
          area: 'Error Handling',
          description: 'No rules cover error handling',
          evidence: 'No rule mentions exceptions',
        },
      ],
      consolidation: [
        {
          ruleIds: [rule.id],
          mergedText: 'Use specific tone guidelines for all responses',
          tokenSavings: 5,
        },
      ],
    };
    const result = makeLintResult({ rules: [rule], deepAnalysis });
    const output = JSON.parse(reporter.report(result));
    expect(output.deepAnalysis).toBeDefined();
    expect(output.deepAnalysis.effectiveness).toHaveLength(1);
    expect(output.deepAnalysis.effectiveness[0].ruleId).toBe(rule.id);
    expect(output.deepAnalysis.effectiveness[0].level).toBe('LOW');
    expect(output.deepAnalysis.coverageGaps).toHaveLength(1);
    expect(output.deepAnalysis.coverageGaps[0].area).toBe('Error Handling');
    expect(output.deepAnalysis.consolidation).toHaveLength(1);
    expect(output.deepAnalysis.consolidation[0].tokenSavings).toBe(5);
  });

  it('does not include deepAnalysis field when deepAnalysis is absent', () => {
    const reporter = new JsonReporter();
    const result = makeLintResult({ deepAnalysis: undefined });
    const output = JSON.parse(reporter.report(result));
    expect(output.deepAnalysis).toBeUndefined();
  });
});
