import type { Rule } from '../parsers/types.js';
import type { AgentAction } from '../sessions/types.js';
import type { Observation } from './types.js';

/** Maps conceptual action names to bash command regex patterns. */
const ACTION_PATTERNS: [string, RegExp][] = [
  ['test', /\b(jest|vitest|pytest|mocha|pnpm\s+test|npm\s+test|yarn\s+test|bun\s+test)\b/i],
  ['lint', /\b(eslint|prettier|biome|pnpm\s+lint|npm\s+run\s+lint)\b/i],
  ['build', /\b(pnpm\s+build|npm\s+run\s+build|yarn\s+build|tsc|webpack|vite\s+build)\b/i],
  ['commit', /\bgit\s+commit\b/i],
  ['push', /\bgit\s+push\b/i],
  ['install', /\b(pnpm\s+install|npm\s+install|yarn\s+install|pip\s+install)\b/i],
  ['format', /\b(prettier|biome\s+format|pnpm\s+format)\b/i],
  ['typecheck', /\b(tsc\s+--noEmit|pnpm\s+typecheck|npm\s+run\s+typecheck)\b/i],
];

/** Ordering keywords and the order they imply: [before-phrase, after-phrase]. */
const ORDERING_PATTERNS: RegExp[] = [
  // "X before Y"
  /(.+?)\s+before\s+(.+)/i,
  // "X prior to Y"
  /(.+?)\s+prior\s+to\s+(.+)/i,
  // "first X then Y"  /  "first X, then Y"
  /first\s+(.+?),?\s+then\s+(.+)/i,
];

const AFTER_RE = /(.+?)\s+after\s+(.+)/i;

interface OrderedPair {
  firstPhrase: string;
  secondPhrase: string;
}

function parseOrdering(text: string): OrderedPair | null {
  for (const re of ORDERING_PATTERNS) {
    const m = re.exec(text);
    if (m) return { firstPhrase: m[1].trim(), secondPhrase: m[2].trim() };
  }

  // "after" flips the order
  const afterMatch = AFTER_RE.exec(text);
  if (afterMatch) return { firstPhrase: afterMatch[2].trim(), secondPhrase: afterMatch[1].trim() };

  return null;
}

/** Resolve a natural language phrase to a bash pattern key. */
function resolveAction(phrase: string): RegExp | null {
  const lower = phrase.toLowerCase();
  for (const [name, pattern] of ACTION_PATTERNS) {
    if (lower.includes(name)) return pattern;
  }
  // Also try matching the phrase as keywords in commands
  if (/\btest/i.test(lower)) return ACTION_PATTERNS.find(([n]) => n === 'test')![1];
  if (/\bcommit/i.test(lower)) return ACTION_PATTERNS.find(([n]) => n === 'commit')![1];
  if (/\bpush/i.test(lower)) return ACTION_PATTERNS.find(([n]) => n === 'push')![1];
  if (/\bbuild/i.test(lower)) return ACTION_PATTERNS.find(([n]) => n === 'build')![1];
  if (/\blint/i.test(lower)) return ACTION_PATTERNS.find(([n]) => n === 'lint')![1];
  return null;
}

/** Get bash actions with their timestamps. */
function bashActionsWithTime(actions: AgentAction[]): { command: string; timestamp: string }[] {
  return actions
    .filter((a): a is Extract<AgentAction, { type: 'bash' }> => a.type === 'bash')
    .map((a) => ({ command: a.command, timestamp: a.timestamp }));
}

/** Find the earliest timestamp where a command matches the pattern. */
function firstMatchTimestamp(
  bashActions: { command: string; timestamp: string }[],
  pattern: RegExp,
): string | null {
  for (const a of bashActions) {
    if (pattern.test(a.command)) return a.timestamp;
  }
  return null;
}

export function verifyBashSequence(
  rule: Rule,
  actions: AgentAction[],
  sessionId: string,
): Observation {
  const base = { ruleId: rule.id, sessionId, method: 'auto:bash-sequence' as const, confidence: 'medium' as const };

  const ordering = parseOrdering(rule.text);
  if (!ordering) return { ...base, relevant: false };

  const firstPattern = resolveAction(ordering.firstPhrase);
  const secondPattern = resolveAction(ordering.secondPhrase);
  if (!firstPattern || !secondPattern) return { ...base, relevant: false };

  const bashes = bashActionsWithTime(actions);
  const firstTime = firstMatchTimestamp(bashes, firstPattern);
  const secondTime = firstMatchTimestamp(bashes, secondPattern);

  // Neither action present - not relevant
  if (!firstTime && !secondTime) return { ...base, relevant: false };

  // Only second present (e.g., committed without testing) - followed: false
  if (!firstTime && secondTime) return { ...base, relevant: true, followed: false };

  // Only first present - not enough info but relevant, followed: null
  if (firstTime && !secondTime) return { ...base, relevant: true, followed: null };

  // Both present - check ordering
  const followed = firstTime! <= secondTime!;
  return { ...base, relevant: true, followed };
}
