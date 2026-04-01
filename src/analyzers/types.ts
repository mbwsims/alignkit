import type { Diagnostic, Rule } from '../parsers/types.js';

export interface DeepAnalysisResult {
  effectiveness: Array<{
    ruleId: string;
    level: 'HIGH' | 'MEDIUM' | 'LOW';
    reason: string;
    suggestedRewrite?: string;
  }>;
  coverageGaps: Array<{
    area: string;
    description: string;
    evidence: string;
  }>;
  consolidation: Array<{
    ruleIds: string[];
    mergedText: string;
    tokenSavings: number;
  }>;
}

export interface TokenAnalysis {
  tokenCount: number;
  contextWindowPercent: number;
  overBudget: boolean;
  budgetThreshold: number;
}

export interface LintResult {
  file: string;
  rules: Rule[];
  fileDiagnostics: Diagnostic[];
  tokenAnalysis: TokenAnalysis;
  discoveredFiles: string[];
  deepAnalysis?: DeepAnalysisResult;
}
