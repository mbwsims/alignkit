import type { Rule } from './types.js';
import { generateRuleId, generateSlug, deduplicateSlugs } from './rule-id.js';
import { classifyRule } from './classifier.js';

// Verbs that can trigger a compound split (exhaustive list per spec)
const SPLIT_VERBS = /\b(always|never|use|run|create|prefer)\b/i;

// Conditional prefixes that prevent splitting on the first sentence
const CONDITIONAL_PREFIXES = /^(when|if|for|during|before|after)\b/i;

// Minimum length for a rule to be meaningful (filters out fragments)
const MIN_RULE_LENGTH = 15;

const DIRECTIVE_START_PATTERN =
  /^(?:(?:IMPORTANT|CRITICAL|NOTE):\s*)?(?:always|never|must|should|use|run|create|prefer|avoid|ensure|write|keep|ask|do not(?!\s+have\b)|don't(?!\s+have\b)|make sure)\b/i;

const CONDITIONAL_DIRECTIVE_PATTERN =
  /^(?:when|if|for|during|before|after)\b.{0,160}\b(?:always|never|must|should|use|run|create|prefer|avoid|ensure|write|keep|ask|do not|don't|make sure)\b/i;

const INLINE_CONSTRAINT_PATTERN =
  /\b(?:use\s+\w+\s+(?:not|instead of)\s+\w+|prefer\s+\w+\s+over\s+\w+|separate from|commit both|for all|no\s+\w+\s+(?:except|unless)|not\s+\w+\s+(?:except|unless))\b/i;

const EMPHATIC_DIRECTIVE_PATTERN =
  /^(?:IMPORTANT|CRITICAL|NEVER|ALWAYS|MUST|REQUIRED|DO NOT|YOU MUST)\b/;

// Patterns that indicate documentation/reference, not instructions.
// These are filtered out even if they contain normative-looking words.
const DOCUMENTATION_PATTERNS = [
  // API route documentation: "`GET /health` — Health check"
  /^`(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+\//,
  // Command reference with em-dash description: "`pnpm dev` — Start dev server"
  /^`[^`]+`\s*[—–-]\s+\w/,
  // Bare file paths or directory descriptions
  /^`?[a-zA-Z_/.]+\/[a-zA-Z_/.]+`?\s*[—–-]/,
  // Markdown tables
  /^\|.+\|$/,
];

interface RawRule {
  text: string;
  section: string | null;
  lineStart: number;
  lineEnd: number;
}

// Section headings that indicate their content is normative (rules/conventions)
const NORMATIVE_SECTIONS =
  /\b(conventions?|rules?|constraints?|principles?|guidelines?|standards?|directives?|must|do not|important|style|practices?|policies?|workflow)\b/i;

function stripLeadingFormatting(text: string): string {
  return text
    .replace(/^(?:\*\*[^*]+\*\*[:\s-]*|`[^`]+`[:\s-]*)+/, '')
    .trim();
}

/**
 * Determine if text is a normative instruction (vs documentation/reference).
 * Uses both text content and section context.
 */
export function isNormativeText(text: string, section: string | null = null): boolean {
  const normalized = stripLeadingFormatting(text);

  // Filter out documentation patterns first — these are never rules
  if (DOCUMENTATION_PATTERNS.some((p) => p.test(text)) || DOCUMENTATION_PATTERNS.some((p) => p.test(normalized))) {
    return false;
  }
  // Items under normative section headings are treated as rules
  // even without explicit imperative verbs (e.g., "TypeScript strict mode"
  // under "## Key Conventions")
  if (section && NORMATIVE_SECTIONS.test(section)) {
    return true;
  }

  return (
    DIRECTIVE_START_PATTERN.test(normalized) ||
    CONDITIONAL_DIRECTIVE_PATTERN.test(normalized) ||
    INLINE_CONSTRAINT_PATTERN.test(normalized) ||
    EMPHATIC_DIRECTIVE_PATTERN.test(normalized)
  );
}

/**
 * Split a sentence-boundary compound rule into individual rules when both
 * sentences contain a split verb AND the first sentence does NOT start with
 * a conditional prefix.
 */
export function splitCompoundRule(text: string): string[] {
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

  return sentences.map((s) => s.trim()).filter((s) => s.length >= MIN_RULE_LENGTH);
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

    if (!joined || joined.length < MIN_RULE_LENGTH) return;

    // Only add if the paragraph contains normative (imperative) language
    if (isNormativeText(joined, currentSection)) {
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
      if (itemText.length >= MIN_RULE_LENGTH && isNormativeText(itemText, currentSection)) {
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

    // Skip markdown tables and blockquotes
    if (/^\|/.test(line) || /^>/.test(line)) {
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
