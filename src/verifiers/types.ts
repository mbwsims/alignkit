import type { Rule } from '../parsers/types.js';
import type { AgentAction } from '../sessions/types.js';

export type Observation =
  | {
      ruleId: string;
      sessionId: string;
      relevant: false;
      method: VerificationMethod;
      confidence: ObservationConfidence;
      evidence?: string;
    }
  | {
      ruleId: string;
      sessionId: string;
      relevant: true;
      followed: boolean | null;
      method: VerificationMethod;
      confidence: ObservationConfidence;
      evidence?: string;
    };

export type VerificationMethod =
  | 'auto:bash-keyword'
  | 'auto:bash-sequence'
  | 'auto:file-pattern'
  | 'auto:heuristic-structure'
  | 'scope:filtered'
  | 'user:custom'
  | 'llm-judge'
  | 'unmapped';

export type ObservationConfidence = 'high' | 'medium' | 'low';

export type VerifierFunction = (
  rule: Rule,
  actions: AgentAction[],
  sessionId: string,
) => Observation;

/**
 * Serialize an Observation into a format suitable for history storage.
 */
export function serializeObservation(obs: Observation): import('../history/types.js').SerializedObservation {
  return {
    ruleId: obs.ruleId,
    sessionId: obs.sessionId,
    relevant: obs.relevant,
    followed: obs.relevant ? obs.followed : null,
    method: obs.method,
    confidence: obs.confidence,
    evidence: obs.evidence,
  };
}
