import { describe, it, expect } from 'vitest';
import { detectVague } from '../../src/analyzers/vague-detector.js';
import { makeRule } from './helpers.js';

describe('detectVague', () => {
  it('flags "Be careful with state management"', () => {
    const rules = [makeRule('Be careful with state management')];
    const result = detectVague(rules);
    expect(result[0].diagnostics).toHaveLength(1);
    expect(result[0].diagnostics[0].code).toBe('VAGUE');
  });

  it('flags "Try to keep functions small"', () => {
    const rules = [makeRule('Try to keep functions small')];
    const result = detectVague(rules);
    expect(result[0].diagnostics).toHaveLength(1);
    expect(result[0].diagnostics[0].code).toBe('VAGUE');
  });

  it('does NOT flag "Use pnpm, not npm"', () => {
    const rules = [makeRule('Use pnpm, not npm')];
    const result = detectVague(rules);
    expect(result[0].diagnostics).toHaveLength(0);
  });

  it('diagnostic message contains guidance about rewriting', () => {
    const rules = [makeRule('Consider using TypeScript for new files')];
    const result = detectVague(rules);
    expect(result[0].diagnostics[0].message.toLowerCase()).toContain('rewrite');
  });

  it('does not mutate input rules', () => {
    const rules = [makeRule('Be careful with error handling')];
    const original = JSON.stringify(rules);
    detectVague(rules);
    expect(JSON.stringify(rules)).toBe(original);
  });
});
