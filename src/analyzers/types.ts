import type { Rule } from '../parsers/types.js';

export interface TokenAnalysis {
  tokenCount: number;
  contextWindowPercent: number;
  overBudget: boolean;
  budgetThreshold: number;
}

export interface LintResult {
  file: string;
  rules: Rule[];
  tokenAnalysis: TokenAnalysis;
  discoveredFiles: string[];
}
