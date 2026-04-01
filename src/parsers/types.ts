export type RuleCategory =
  | 'tool-constraint'
  | 'code-structure'
  | 'process-ordering'
  | 'style-guidance'
  | 'behavioral'
  | 'meta';

export type Verifiability = 'auto' | 'user-config' | 'unverifiable';

import type { RuleApplicability } from './rule-applicability.js';
export type PlacementTarget = 'tool-config' | 'scoped-rule' | 'hook' | 'subagent';

export interface PlacementSuggestion {
  target: PlacementTarget;
  confidence: 'high';
  detail?: string;
}

export interface Diagnostic {
  severity: 'error' | 'warning';
  code: 'VAGUE' | 'CONFLICT' | 'REDUNDANT' | 'STALE' | 'ORDERING'
    | 'EFFECTIVENESS' | 'COVERAGE_GAP' | 'CONSOLIDATION' | 'REWRITE' | 'PLACEMENT'
    | 'LINTER_JOB' | 'WEAK_EMPHASIS' | 'METADATA';
  message: string;
  relatedRuleId?: string;
  placement?: PlacementSuggestion;
}

export interface Rule {
  id: string;
  slug: string;
  text: string;
  source: {
    file: string;
    lineStart: number;
    lineEnd: number;
    section: string | null;
  };
  category: RuleCategory;
  verifiability: Verifiability;
  diagnostics: Diagnostic[];
  applicability?: RuleApplicability;
}
