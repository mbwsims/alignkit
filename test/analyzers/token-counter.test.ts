import { describe, it, expect } from 'vitest';
import { countTokens, analyzeTokens } from '../../src/analyzers/token-counter.js';
import { makeRule } from './helpers.js';

describe('countTokens', () => {
  it('returns positive tokenCount for non-empty text', () => {
    const result = countTokens('Use pnpm instead of npm for package management');
    expect(result).toBeGreaterThan(0);
  });

  it('uses cl100k_base encoding (any non-empty English text returns >0 tokens)', () => {
    const result = countTokens('hello world');
    expect(result).toBeGreaterThan(0);
  });
});

describe('analyzeTokens', () => {
  it('calculates contextWindowPercent correctly (100 words against 1000 window → >0, ≤100)', () => {
    const text = Array(100).fill('word').join(' ');
    const rules = [makeRule(text)];
    const result = analyzeTokens(rules, { contextWindow: 1000 });
    expect(result.contextWindowPercent).toBeGreaterThan(0);
    expect(result.contextWindowPercent).toBeLessThanOrEqual(100);
  });

  it('flags overBudget when tokenCount exceeds budget', () => {
    const text = Array(500).fill('word').join(' ');
    const rules = [makeRule(text)];
    const result = analyzeTokens(rules, { tokenBudget: 10 });
    expect(result.overBudget).toBe(true);
  });

  it('does not flag overBudget when under budget', () => {
    const rules = [makeRule('Use pnpm')];
    const result = analyzeTokens(rules, { tokenBudget: 10000 });
    expect(result.overBudget).toBe(false);
  });
});
