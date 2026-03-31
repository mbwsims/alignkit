import { describe, it, expect } from 'vitest';
import { detectWeakEmphasis } from '../../src/analyzers/emphasis-detector.js';
import { makeRule } from './helpers.js';

describe('detectWeakEmphasis', () => {
  it('flags high-priority rule with "should"', () => {
    const rules = [makeRule('You should use Prisma for data access', { category: 'tool-constraint' })];
    const result = detectWeakEmphasis(rules);
    expect(result[0].diagnostics).toHaveLength(1);
    expect(result[0].diagnostics[0].code).toBe('WEAK_EMPHASIS');
  });

  it('flags high-priority rule with "prefer"', () => {
    const rules = [makeRule('Prefer running tests before committing', { category: 'process-ordering' })];
    const result = detectWeakEmphasis(rules);
    expect(result[0].diagnostics).toHaveLength(1);
    expect(result[0].diagnostics[0].code).toBe('WEAK_EMPHASIS');
  });

  it('flags high-priority rule with "ideally"', () => {
    const rules = [makeRule('Ideally use pnpm for package management', { category: 'tool-constraint' })];
    const result = detectWeakEmphasis(rules);
    expect(result[0].diagnostics).toHaveLength(1);
    expect(result[0].diagnostics[0].code).toBe('WEAK_EMPHASIS');
  });

  it('does NOT flag high-priority rule with MUST', () => {
    const rules = [makeRule('You MUST use Prisma for data access', { category: 'tool-constraint' })];
    const result = detectWeakEmphasis(rules);
    expect(result[0].diagnostics).toHaveLength(0);
  });

  it('does NOT flag high-priority rule with NEVER', () => {
    const rules = [makeRule('NEVER commit secrets to the repository', { category: 'process-ordering' })];
    const result = detectWeakEmphasis(rules);
    expect(result[0].diagnostics).toHaveLength(0);
  });

  it('does NOT flag high-priority rule with ALWAYS', () => {
    const rules = [makeRule('ALWAYS run tests before committing', { category: 'process-ordering' })];
    const result = detectWeakEmphasis(rules);
    expect(result[0].diagnostics).toHaveLength(0);
  });

  it('does NOT flag low-priority categories even with weak language', () => {
    const rules = [makeRule('You should keep functions small', { category: 'style-guidance' })];
    const result = detectWeakEmphasis(rules);
    expect(result[0].diagnostics).toHaveLength(0);
  });

  it('does NOT flag behavioral category even with weak language', () => {
    const rules = [makeRule('You should explain your reasoning', { category: 'behavioral' })];
    const result = detectWeakEmphasis(rules);
    expect(result[0].diagnostics).toHaveLength(0);
  });

  it('does NOT flag high-priority rule without weak language', () => {
    const rules = [makeRule('Use Prisma for all data access', { category: 'tool-constraint' })];
    const result = detectWeakEmphasis(rules);
    expect(result[0].diagnostics).toHaveLength(0);
  });

  it('does NOT flag if rule has both emphasis and weak language', () => {
    const rules = [makeRule('You MUST use pnpm — you should never use npm', { category: 'tool-constraint' })];
    const result = detectWeakEmphasis(rules);
    // Has MUST, so emphasis is present — no diagnostic
    expect(result[0].diagnostics).toHaveLength(0);
  });
});
