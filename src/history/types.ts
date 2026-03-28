export interface SessionResult {
  sessionId: string;
  timestamp: string;
  rulesVersion: string;
  analysisVersion: string;
  observations: SerializedObservation[];
}

/** Flattened for JSONL storage (no discriminated union). */
export interface SerializedObservation {
  ruleId: string;
  sessionId: string;
  relevant: boolean;
  followed: boolean | null;
  method: string;
  confidence: string;
}
