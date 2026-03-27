import { getEncoding } from 'js-tiktoken';
import type { Rule } from '../parsers/types.js';
import type { TokenAnalysis } from './types.js';

const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_TOKEN_BUDGET = 2_000;

export function countTokens(text: string): number {
  const enc = getEncoding('cl100k_base');
  const tokens = enc.encode(text);
  return tokens.length;
}

export interface TokenOptions {
  contextWindow?: number;
  tokenBudget?: number;
}

export function analyzeTokens(rules: Rule[], options?: TokenOptions): TokenAnalysis {
  const contextWindow = options?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const budgetThreshold = options?.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

  const allText = rules.map((r) => r.text).join('\n');
  const tokenCount = countTokens(allText);
  const contextWindowPercent = (tokenCount / contextWindow) * 100;
  const overBudget = tokenCount > budgetThreshold;

  return {
    tokenCount,
    contextWindowPercent,
    overBudget,
    budgetThreshold,
  };
}
