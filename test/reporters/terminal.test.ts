import { describe, it, expect } from 'vitest';
import { TerminalReporter } from '../../src/reporters/terminal.js';
import { makeRule } from '../analyzers/helpers.js';
import type { LintResult, DeepAnalysisResult } from '../../src/analyzers/types.js';
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

// Strip ANSI escape codes for easier assertion
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

describe('TerminalReporter', () => {
  it('includes the file name in output', () => {
    const reporter = new TerminalReporter();
    const result = makeLintResult({ file: 'CLAUDE.md' });
    const output = stripAnsi(reporter.report(result));
    expect(output).toContain('CLAUDE.md');
  });

  it('shows diagnostic codes when present', () => {
    const reporter = new TerminalReporter();
    const diag: Diagnostic = { severity: 'warning', code: 'VAGUE', message: 'This rule is too vague' };
    const rule = { ...makeRule('Always be helpful in all cases'), diagnostics: [diag] };
    const result = makeLintResult({ rules: [rule] });
    const output = stripAnsi(reporter.report(result));
    expect(output).toContain('VAGUE');
  });

  it('shows CONFLICT diagnostic code when present', () => {
    const reporter = new TerminalReporter();
    const diag: Diagnostic = { severity: 'error', code: 'CONFLICT', message: 'Conflicts with another rule' };
    const rule = { ...makeRule('Never use tabs for indentation'), diagnostics: [diag] };
    const result = makeLintResult({ rules: [rule] });
    const output = stripAnsi(reporter.report(result));
    expect(output).toContain('CONFLICT');
  });

  it('shows HEALTH summary line', () => {
    const reporter = new TerminalReporter();
    const rules = [makeRule('Use pnpm'), makeRule('Never commit secrets')];
    const result = makeLintResult({ rules });
    const output = stripAnsi(reporter.report(result));
    expect(output).toContain('HEALTH');
  });

  it('shows TOKENS summary line', () => {
    const reporter = new TerminalReporter();
    const result = makeLintResult();
    const output = stripAnsi(reporter.report(result));
    expect(output).toContain('TOKENS');
  });

  it('shows discovery line when multiple files found', () => {
    const reporter = new TerminalReporter();
    const discoveredFiles = ['CLAUDE.md', '.cursor/rules/base.md', '.cursor/rules/python.md'];
    const result = makeLintResult({ discoveredFiles });
    const output = stripAnsi(reporter.report(result));
    expect(output).toContain('3');
    expect(output).toContain('instruction file');
  });

  it('does not show discovery line for single file', () => {
    const reporter = new TerminalReporter();
    const result = makeLintResult({ discoveredFiles: ['CLAUDE.md'] });
    const output = stripAnsi(reporter.report(result));
    // Should not have a "Found N instruction files" line for single file
    expect(output).not.toMatch(/Found \d+ instruction files/);
  });

  it('shows token count in TOKENS line', () => {
    const reporter = new TerminalReporter();
    const result = makeLintResult({
      tokenAnalysis: {
        tokenCount: 3200,
        contextWindowPercent: 16,
        overBudget: false,
        budgetThreshold: 20000,
      },
    });
    const output = stripAnsi(reporter.report(result));
    expect(output).toContain('3,200');
  });

  it('shows rule count in HEALTH summary', () => {
    const reporter = new TerminalReporter();
    const rules = [makeRule('Use pnpm'), makeRule('Never commit'), makeRule('Write tests')];
    const result = makeLintResult({ rules });
    const output = stripAnsi(reporter.report(result));
    expect(output).toContain('3 rules');
  });

  it('shows EFFECTIVENESS section when deepAnalysis has a LOW effectiveness rule', () => {
    const reporter = new TerminalReporter();
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
      coverageGaps: [],
      consolidation: [],
    };
    const result = makeLintResult({ rules: [rule], deepAnalysis });
    const output = stripAnsi(reporter.report(result));
    expect(output).toContain('EFFECTIVENESS');
    expect(output).toContain('LOW');
  });

  it('shows COVERAGE GAPS section with area name when deepAnalysis has coverage gaps', () => {
    const reporter = new TerminalReporter();
    const deepAnalysis: DeepAnalysisResult = {
      effectiveness: [],
      coverageGaps: [
        {
          area: 'Error Handling',
          description: 'No rules cover error handling patterns',
          evidence: 'No rule mentions exceptions or errors',
        },
      ],
      consolidation: [],
    };
    const result = makeLintResult({ deepAnalysis });
    const output = stripAnsi(reporter.report(result));
    expect(output).toContain('COVERAGE GAPS');
    expect(output).toContain('Error Handling');
  });

  it('shows CONSOLIDATION section with MERGE when deepAnalysis has consolidation suggestions', () => {
    const reporter = new TerminalReporter();
    const rule1 = makeRule('Use pnpm for installs');
    const rule2 = makeRule('Use pnpm for scripts');
    const deepAnalysis: DeepAnalysisResult = {
      effectiveness: [],
      coverageGaps: [],
      consolidation: [
        {
          ruleIds: [rule1.id, rule2.id],
          mergedText: 'Use pnpm for all package operations and scripts',
          tokenSavings: 10,
        },
      ],
    };
    const result = makeLintResult({ rules: [rule1, rule2], deepAnalysis });
    const output = stripAnsi(reporter.report(result));
    expect(output).toContain('CONSOLIDATION');
    expect(output).toContain('MERGE');
  });

  it('does not show deep analysis sections when deepAnalysis is undefined', () => {
    const reporter = new TerminalReporter();
    const result = makeLintResult({ deepAnalysis: undefined });
    const output = stripAnsi(reporter.report(result));
    expect(output).not.toContain('EFFECTIVENESS');
    expect(output).not.toContain('COVERAGE GAPS');
    expect(output).not.toContain('CONSOLIDATION');
  });
});
