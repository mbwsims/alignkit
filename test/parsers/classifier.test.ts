import { describe, it, expect } from 'vitest';
import { classifyRule } from '../../src/parsers/classifier.js';

describe('classifyRule', () => {
  describe('tool-constraint category', () => {
    it('classifies "Use pnpm, not npm" as tool-constraint', () => {
      const result = classifyRule('Use pnpm, not npm');
      expect(result.category).toBe('tool-constraint');
    });

    it('classifies "Always run jest before committing" as tool-constraint', () => {
      const result = classifyRule('Always run jest before committing');
      expect(result.category).toBe('tool-constraint');
    });

    it('classifies "Use docker for local development" as tool-constraint', () => {
      const result = classifyRule('Use docker for local development');
      expect(result.category).toBe('tool-constraint');
    });
  });

  describe('code-structure category', () => {
    it('classifies "Always use named exports" as code-structure', () => {
      const result = classifyRule('Always use named exports');
      expect(result.category).toBe('code-structure');
    });

    it('classifies "Prefer interfaces over type aliases" as code-structure', () => {
      const result = classifyRule('Prefer interfaces over type aliases');
      expect(result.category).toBe('code-structure');
    });
  });

  describe('process-ordering category', () => {
    it('classifies "Run tests before committing" as process-ordering', () => {
      const result = classifyRule('Run tests before committing');
      expect(result.category).toBe('process-ordering');
    });

    it('classifies "Always lint first, then build" as process-ordering', () => {
      const result = classifyRule('Always lint first, then build');
      expect(result.category).toBe('process-ordering');
    });
  });

  describe('style-guidance category', () => {
    it('classifies "Write clean, readable code" as style-guidance', () => {
      const result = classifyRule('Write clean, readable code');
      expect(result.category).toBe('style-guidance');
    });

    it('classifies "Use meaningful variable names" as style-guidance', () => {
      const result = classifyRule('Use meaningful variable names');
      expect(result.category).toBe('style-guidance');
    });
  });

  describe('behavioral category', () => {
    it('classifies "Think step by step before answering" as behavioral', () => {
      const result = classifyRule('Think step by step before answering');
      expect(result.category).toBe('behavioral');
    });

    it('classifies "Consider edge cases carefully" as behavioral', () => {
      const result = classifyRule('Consider edge cases carefully');
      expect(result.category).toBe('behavioral');
    });
  });

  describe('meta category', () => {
    it('classifies "This file describes the project setup" as meta', () => {
      const result = classifyRule('This file describes the project setup');
      expect(result.category).toBe('meta');
    });

    it('classifies "These instructions apply to the codebase" as meta', () => {
      const result = classifyRule('These instructions apply to the codebase');
      expect(result.category).toBe('meta');
    });
  });

  describe('default behavior', () => {
    it('defaults to behavioral when no keywords match', () => {
      const result = classifyRule('Do the right thing');
      expect(result.category).toBe('behavioral');
    });
  });

  describe('priority ordering', () => {
    it('tool-constraint wins over style-guidance when both keywords are present', () => {
      const result = classifyRule('Use pnpm for clean dependency management');
      expect(result.category).toBe('tool-constraint');
    });
  });

  describe('verifiability mapping', () => {
    it('returns auto for tool-constraint', () => {
      const result = classifyRule('Use pnpm, not npm');
      expect(result.verifiability).toBe('auto');
    });

    it('returns auto for code-structure', () => {
      const result = classifyRule('Always use named exports');
      expect(result.verifiability).toBe('auto');
    });

    it('returns auto for process-ordering', () => {
      const result = classifyRule('Run tests before committing');
      expect(result.verifiability).toBe('auto');
    });

    it('returns unverifiable for style-guidance', () => {
      const result = classifyRule('Write clean, readable code');
      expect(result.verifiability).toBe('unverifiable');
    });

    it('returns unverifiable for behavioral', () => {
      const result = classifyRule('Think step by step before answering');
      expect(result.verifiability).toBe('unverifiable');
    });

    it('returns user-config for meta', () => {
      const result = classifyRule('This file describes the project setup');
      expect(result.verifiability).toBe('user-config');
    });
  });
});
