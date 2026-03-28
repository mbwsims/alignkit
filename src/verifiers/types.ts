import type { Rule } from '../parsers/types.js';
import type { AgentAction } from '../sessions/types.js';

export type Observation =
  | {
      ruleId: string;
      sessionId: string;
      relevant: false;
      method: VerificationMethod;
      confidence: ObservationConfidence;
    }
  | {
      ruleId: string;
      sessionId: string;
      relevant: true;
      followed: boolean | null;
      method: VerificationMethod;
      confidence: ObservationConfidence;
    };

export type VerificationMethod =
  | 'auto:bash-keyword'
  | 'auto:bash-sequence'
  | 'auto:file-pattern'
  | 'auto:heuristic-structure'
  | 'user:custom'
  | 'llm-judge'
  | 'unmapped';

export type ObservationConfidence = 'high' | 'medium' | 'low';

export type VerifierFunction = (
  rule: Rule,
  actions: AgentAction[],
  sessionId: string,
) => Observation;
