import { describe, it, expect } from 'vitest';
import { JsonReporter } from '../../src/reporters/json.js';
import { makeRule } from '../analyzers/helpers.js';
import type { LintResult } from '../../src/analyzers/types.js';
import type { Diagnostic } from '../../src/parsers/types.js';

function makeLintResult(overrides?: Partial<LintResult>): LintResult {
  return {
    file: 'CLAUDE.md',
    rules: [],
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
});
