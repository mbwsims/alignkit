import type { Rule } from '../parsers/types.js';
import type { AgentAction } from '../sessions/types.js';
import { ruleAppliesToAnyPath, ruleAppliesToPath } from '../parsers/rule-applicability.js';
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
  cwd?: string,
): Observation[] {
  return rules.map((rule) => {
    let scopedActions = actions;

    if (rule.applicability) {
      const fileActions = actions.filter(
        (action): action is Extract<AgentAction, { filePath: string }> =>
          action.type === 'read' || action.type === 'write' || action.type === 'edit',
      );
      const touchedPaths = fileActions.map((action) => action.filePath);

      if (!ruleAppliesToAnyPath(rule, touchedPaths, cwd)) {
        return {
          ruleId: rule.id,
          sessionId,
          relevant: false,
          method: 'scope:filtered' as const,
          confidence: 'high' as const,
          evidence: `No touched files matched this rule's scope (${rule.applicability.patterns.join(', ')}).`,
        };
      }

      scopedActions = actions.filter((action) =>
        action.type === 'bash' ||
        !('filePath' in action) ||
        ruleAppliesToPath(rule, action.filePath, cwd),
      );
    }

    const verifier = autoMap(rule);

    if (!verifier) {
      return {
        ruleId: rule.id,
        sessionId,
        relevant: false,
        method: 'unmapped' as const,
        confidence: 'low' as const,
        evidence: 'No verifier matched this rule.',
      };
    }

    return verifier(rule, scopedActions, sessionId);
  });
}
