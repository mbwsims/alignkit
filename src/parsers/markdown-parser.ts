import type { Rule } from './types.js';
import { generateRuleId, generateSlug, deduplicateSlugs } from './rule-id.js';
import { classifyRule } from './classifier.js';

// Verbs that can trigger a compound split (exhaustive list per spec)
const SPLIT_VERBS = /\b(always|never|use|run|create|prefer)\b/i;

// Conditional prefixes that prevent splitting on the first sentence
const CONDITIONAL_PREFIXES = /^(when|if|for|during)\b/i;

// Patterns that mark text as normative (an instruction or constraint).
// Includes imperative verbs AND declarative constraint patterns.
const NORMATIVE_PATTERN = new RegExp(
  [
    // Imperative verbs
    /\b(always|never|must|should|use|run|create|prefer|avoid|ensure|write|do not|don't|make sure|keep)\b/,
    // Declarative constraints: "X for all Y", "no X except Y", "only X"
    /\b(for all|no\s+\w+\s+(except|unless)|not\s+\w+\s+(except|unless)|only)\b/,
    // Convention declarations: "TypeScript strict mode" (bare noun phrase under a conventions/rules heading)
    // These are handled by section context below, not by this pattern.
  ]
    .map((r) => r.source)
    .join('|'),
  'i',
);

// Patterns that indicate documentation/reference, not instructions.
// These are filtered out even if they contain normative-looking words.
const DOCUMENTATION_PATTERNS = [
  // Bold-prefixed architecture descriptions: "**Framework:** Next.js 16"
  /^\*\*\w[^*]*\*\*[:\s]/,
  // API route documentation: "`GET /health` — Health check"
  /^`(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\//,
  // Command reference with em-dash description: "`pnpm dev` — Start dev server"
  /^`[^`]+`\s*[—–-]\s+\w/,
  // Bare file paths or directory descriptions
  /^`?[a-zA-Z_/.]+\/[a-zA-Z_/.]+`?\s*[—–-]/,
];

interface RawRule {
  text: string;
  section: string | null;
  lineStart: number;
  lineEnd: number;
}

// Section headings that indicate their content is normative (rules/conventions)
const NORMATIVE_SECTIONS =
  /\b(conventions?|rules?|requirements?|constraints?|principles?|guidelines?|standards?|directives?|must|do not|important|style|practices?|policies?|workflow)\b/i;

/**
 * Determine if text is a normative instruction (vs documentation/reference).
 * Uses both text content and section context.
 */
function isNormative(text: string, section: string | null = null): boolean {
  // Filter out documentation patterns first — these are never rules
  if (DOCUMENTATION_PATTERNS.some((p) => p.test(text))) {
    return false;
  }
  // Explicit normative language in the text itself
  if (NORMATIVE_PATTERN.test(text)) {
    return true;
  }
  // Items under normative section headings are treated as rules
  // even without explicit imperative verbs (e.g., "TypeScript strict mode"
  // under "## Key Conventions")
  if (section && NORMATIVE_SECTIONS.test(section)) {
    return true;
  }
  return false;
}

/**
 * Split a sentence-boundary compound rule into individual rules when both
 * sentences contain a split verb AND the first sentence does NOT start with
 * a conditional prefix.
 */
function splitCompoundRule(text: string): string[] {
  // Split on sentence boundaries: ". " followed by an uppercase letter
  const sentencePattern = /(?<=\.\s)(?=[A-Z])/;
  const sentences = text.split(sentencePattern);

  if (sentences.length < 2) {
    return [text];
  }

  // The first sentence must NOT start with a conditional
  if (CONDITIONAL_PREFIXES.test(sentences[0].trimStart())) {
    return [text];
  }

  // All sentences must contain a split verb to trigger splitting
  // (We check pairwise from the first split point)
  const allHaveSplitVerb = sentences.every((s) => SPLIT_VERBS.test(s));
  if (!allHaveSplitVerb) {
    return [text];
  }

  return sentences.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Parse a markdown file and extract Rule objects.
 */
export function parseMarkdown(content: string, filePath: string): Rule[] {
  const lines = content.split('\n');
  const rawRules: RawRule[] = [];

  let currentSection: string | null = null;
  let inCodeFence = false;
  let paragraphLines: Array<{ text: string; lineNum: number }> = [];

  function flushParagraph(): void {
    if (paragraphLines.length === 0) return;

    const joined = paragraphLines.map((l) => l.text).join(' ').trim();
    const lineStart = paragraphLines[0].lineNum;
    const lineEnd = paragraphLines[paragraphLines.length - 1].lineNum;
    paragraphLines = [];

    if (!joined) return;

    // Only add if the paragraph contains normative (imperative) language
    if (isNormative(joined, currentSection)) {
      rawRules.push({
        text: joined,
        section: currentSection,
        lineStart,
        lineEnd,
      });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1; // 1-based
    const line = lines[i];

    // Toggle code fence state
    if (/^```/.test(line)) {
      if (!inCodeFence) {
        // Entering a code fence — flush any pending paragraph first
        flushParagraph();
      }
      inCodeFence = !inCodeFence;
      continue;
    }

    // Skip everything inside code fences
    if (inCodeFence) {
      continue;
    }

    // Heading match
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      currentSection = headingMatch[1].trim();
      continue;
    }

    // List item match (unordered: - or *, ordered: 1.)
    const listMatch = line.match(/^[-*]\s+(.+)$/) ?? line.match(/^\d+\.\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      const itemText = listMatch[1].trim();
      // Only add list items that contain normative language.
      // This filters out documentation items like "**Framework:** Next.js 16"
      // and command references like "`pnpm dev` — Start dev server".
      if (isNormative(itemText, currentSection)) {
        rawRules.push({
          text: itemText,
          section: currentSection,
          lineStart: lineNum,
          lineEnd: lineNum,
        });
      }
      continue;
    }

    // Blank line — flush paragraph accumulator
    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    // Regular line — accumulate into paragraph
    paragraphLines.push({ text: line.trim(), lineNum });
  }

  // Flush any remaining paragraph at EOF
  flushParagraph();

  // Expand compound rules
  const expandedRules: RawRule[] = [];
  for (const raw of rawRules) {
    const parts = splitCompoundRule(raw.text);
    for (const part of parts) {
      expandedRules.push({
        text: part,
        section: raw.section,
        lineStart: raw.lineStart,
        lineEnd: raw.lineEnd,
      });
    }
  }

  // Generate deduplicated slugs
  const slugs = deduplicateSlugs(expandedRules.map((r) => generateSlug(r.text)));

  // Build final Rule objects
  return expandedRules.map((raw, idx) => {
    const { category, verifiability } = classifyRule(raw.text);
    return {
      id: generateRuleId(raw.text),
      slug: slugs[idx],
      text: raw.text,
      source: {
        file: filePath,
        lineStart: raw.lineStart,
        lineEnd: raw.lineEnd,
        section: raw.section,
      },
      category,
      verifiability,
      diagnostics: [],
    };
  });
}
