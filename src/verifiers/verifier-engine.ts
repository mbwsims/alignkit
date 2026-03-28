import type { Rule } from '../parsers/types.js';
import type { AgentAction } from '../sessions/types.js';
import type { Observation } from './types.js';
import { autoMap } from './auto-mapper.js';

/**
 * Verify all rules against a session's actions.
 *
 * For each rule:
 * 1. Try autoMap to get a verifier function
 * 2. If no verifier → return an unmapped observation
 * 3. If verifier → call it and return the observation
 */
export function verifySession(
  rules: Rule[],
  actions: AgentAction[],
  sessionId: string,
): Observation[] {
  return rules.map((rule) => {
    const verifier = autoMap(rule);

    if (!verifier) {
      return {
        ruleId: rule.id,
        sessionId,
        relevant: false,
        method: 'unmapped' as const,
        confidence: 'low' as const,
      };
    }

    return verifier(rule, actions, sessionId);
  });
}
