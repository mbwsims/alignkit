import { describe, it, expect } from 'vitest';
import { detectLinterRules } from '../../src/analyzers/linter-rule-detector.js';
import { makeRule } from './helpers.js';

describe('detectLinterRules', () => {
  it('flags indentation rules', () => {
    const rules = [makeRule('Use 2 space indentation')];
    const result = detectLinterRules(rules);
    expect(result[0].diagnostics).toHaveLength(1);
    expect(result[0].diagnostics[0].code).toBe('LINTER_JOB');
  });

  it('flags semicolon rules', () => {
    const rules = [makeRule('Always use semicolons at the end of statements')];
    const result = detectLinterRules(rules);
    expect(result[0].diagnostics).toHaveLength(1);
    expect(result[0].diagnostics[0].code).toBe('LINTER_JOB');
  });

  it('flags quote style rules', () => {
    const rules = [makeRule('Use single quotes for strings')];
    const result = detectLinterRules(rules);
    expect(result[0].diagnostics).toHaveLength(1);
    expect(result[0].diagnostics[0].code).toBe('LINTER_JOB');
  });

  it('flags trailing comma rules', () => {
    const rules = [makeRule('Always add trailing commas in multiline objects')];
    const result = detectLinterRules(rules);
    expect(result[0].diagnostics).toHaveLength(1);
    expect(result[0].diagnostics[0].code).toBe('LINTER_JOB');
  });

  it('flags line length rules', () => {
    const rules = [makeRule('Lines should be no longer than 80 characters per line')];
    const result = detectLinterRules(rules);
    expect(result[0].diagnostics).toHaveLength(1);
    expect(result[0].diagnostics[0].code).toBe('LINTER_JOB');
  });

  it('flags import sorting rules', () => {
    const rules = [makeRule('Sort imports alphabetically')];
    const result = detectLinterRules(rules);
    expect(result[0].diagnostics).toHaveLength(1);
    expect(result[0].diagnostics[0].code).toBe('LINTER_JOB');
  });

  it('flags trailing whitespace rules', () => {
    const rules = [makeRule('No trailing whitespace at end of lines')];
    const result = detectLinterRules(rules);
    expect(result[0].diagnostics).toHaveLength(1);
    expect(result[0].diagnostics[0].code).toBe('LINTER_JOB');
  });

  it('flags naming convention rules', () => {
    const rules = [makeRule('Use camelCase for variable naming conventions')];
    const result = detectLinterRules(rules);
    expect(result[0].diagnostics).toHaveLength(1);
    expect(result[0].diagnostics[0].code).toBe('LINTER_JOB');
  });

  it('does NOT flag behavioral rules', () => {
    const rules = [makeRule('Use Prisma for all data access — no raw SQL')];
    const result = detectLinterRules(rules);
    expect(result[0].diagnostics).toHaveLength(0);
  });

  it('does NOT flag process rules', () => {
    const rules = [makeRule('Run tests before committing')];
    const result = detectLinterRules(rules);
    expect(result[0].diagnostics).toHaveLength(0);
  });

  it('does NOT flag tool constraint rules', () => {
    const rules = [makeRule('Use pnpm, not npm or yarn')];
    const result = detectLinterRules(rules);
    expect(result[0].diagnostics).toHaveLength(0);
  });

  it('mentions the suggested tool in the message', () => {
    const rules = [makeRule('Use 4 space indentation everywhere')];
    const result = detectLinterRules(rules);
    expect(result[0].diagnostics[0].message).toContain('prettier/eslint');
  });
});
