import type { Rule } from '../parsers/types.js';
import type { VerifierFunction } from './types.js';
import { verifyHeuristicStructure } from './heuristic-structure.js';
import { verifyFilePattern } from './file-pattern.js';
import { verifyBashSequence } from './bash-sequence.js';
import { verifyBashKeyword } from './bash-keyword.js';

/**
 * Map a Rule to the most appropriate verifier function.
 *
 * Priority: heuristic-structure > file-pattern > bash-sequence > bash-keyword
 *
 * Returns `null` for unverifiable rules.
 */
export function autoMap(rule: Rule): VerifierFunction | null {
  if (rule.verifiability === 'unverifiable') return null;

  // Priority 1: code-structure rules → heuristic-structure
  if (rule.category === 'code-structure') return verifyHeuristicStructure;

  // Priority 2: rules mentioning file paths/directories → file-pattern
  if (hasFilePatternSignals(rule.text)) return verifyFilePattern;

  // Priority 3: process-ordering rules → bash-sequence
  if (rule.category === 'process-ordering' || hasOrderingSignals(rule.text)) return verifyBashSequence;

  // Priority 4: tool-constraint rules → bash-keyword
  if (rule.category === 'tool-constraint' || hasToolSignals(rule.text)) return verifyBashKeyword;

  return null;
}

/** Detect file/directory pattern references in rule text. */
function hasFilePatternSignals(text: string): boolean {
  return (
    /\b(?:__tests__|src\/|lib\/|test\/|spec\/)\b/.test(text) ||
    /\.\w+\s+(?:files?|extension)/.test(text) ||
    /\b(?:in|inside|under|within)\s+[`"]?\w+\//.test(text)
  );
}

/** Detect ordering keywords in rule text. */
function hasOrderingSignals(text: string): boolean {
  return /\b(?:before|after|prior\s+to|first\s+.+then)\b/i.test(text);
}

/** Detect tool/command mentions in rule text. */
function hasToolSignals(text: string): boolean {
  return /\b(?:pnpm|npm|yarn|bun|jest|vitest|mocha|git|docker|eslint|prettier|biome)\b/i.test(text);
}
