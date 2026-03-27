export type RuleCategory =
  | 'tool-constraint'
  | 'code-structure'
  | 'process-ordering'
  | 'style-guidance'
  | 'behavioral'
  | 'meta';

export type Verifiability = 'auto' | 'user-config' | 'unverifiable';

export interface Diagnostic {
  severity: 'error' | 'warning';
  code: 'VAGUE' | 'CONFLICT' | 'REDUNDANT' | 'STALE' | 'ORDERING';
  message: string;
  relatedRuleId?: string;
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
}
