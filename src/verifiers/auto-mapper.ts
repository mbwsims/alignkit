import type { Rule } from '../parsers/types.js';
import type { VerifierFunction } from './types.js';
import { matchesHeuristicStructureRule, verifyHeuristicStructure } from './heuristic-structure.js';
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

  // Priority 1: only map structural rules when we have a concrete heuristic
  if (matchesHeuristicStructureRule(rule.text)) return verifyHeuristicStructure;

  // Priority 2: rules mentioning file paths/directories → file-pattern
  if (hasFilePatternSignals(rule.text)) return verifyFilePattern;

  // Priority 3: process-ordering rules → bash-sequence
  if (rule.category === 'process-ordering' || hasOrderingSignals(rule.text)) return verifyBashSequence;

  // Priority 4: command-usage rules → bash-keyword
  if (hasDirectCommandSignals(rule.text)) return verifyBashKeyword;

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
function hasDirectCommandSignals(text: string): boolean {
  if (/\buse\s+\w+[\s,]+not\s+\w+\b/i.test(text)) return true;
  if (/\buse\s+\w+\s+instead\s+of\s+\w+\b/i.test(text)) return true;
  if (/\bprefer\s+\w+\s+over\s+\w+\b/i.test(text)) return true;
  if (/`[^`]+`/.test(text)) return true;
  if (/\b(?:run|execute|invoke)\s+\S+/i.test(text)) return true;
  if (/\b(?:git|docker)\b/i.test(text)) return true;

  const commandTools = /\b(?:pnpm|npm|yarn|bun|npx|pip|brew|apt|cargo|make|pytest|jest|vitest|mocha|eslint|prettier|biome|tsc)\b/i;
  const commandContexts = /\b(?:package management|dependencies|dependency|install|script|scripts|test|tests|testing|lint|format|build|typecheck|commit|push)\b/i;
  return commandTools.test(text) && commandContexts.test(text);
}
