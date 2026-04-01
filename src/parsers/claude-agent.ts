import type { Rule } from './types.js';
import { classifyRule } from './classifier.js';
import { extractInstructionFrontmatter } from './frontmatter.js';
import { isNormativeText, splitCompoundRule } from './markdown-parser.js';
import { deduplicateSlugs, generateRuleId, generateSlug } from './rule-id.js';

interface RawRule {
  text: string;
  section: string | null;
  lineStart: number;
  lineEnd: number;
}

const MIN_RULE_LENGTH = 15;
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+(?=[A-Z])/;
const AGENT_INTRO_PATTERN = /^(?:you are|this agent(?: is)?|act as)\b/i;
const AGENT_DIRECTIVE_PATTERN =
  /^(?:(?:when|if|whenever|before|after)\b.{0,200}\b(?:run|review|analyze|investigate|fix|use|delegate|escalate|ask|look for|check|write|preserve|keep|prefer|avoid|ensure|verify|focus on|pay attention|pay special attention)\b|(?:focus on|pay attention to|pay special attention to|look for|review|analyze|investigate|verify|preserve|keep|prefer|avoid|ensure|escalate|delegate|run|check|write|fix)\b)/i;

function isAgentDirective(text: string, section: string | null): boolean {
  return isNormativeText(text, section) || AGENT_DIRECTIVE_PATTERN.test(text.trim());
}

function splitIntoCandidateRules(raw: RawRule): RawRule[] {
  const normalized = raw.text.trim();
  if (!normalized || normalized.length < MIN_RULE_LENGTH) {
    return [];
  }

  const sentences = normalized
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= MIN_RULE_LENGTH)
    .filter((sentence, index) => !(index === 0 && AGENT_INTRO_PATTERN.test(sentence)));

  const candidates = sentences.length > 1 ? sentences : [normalized];
  const extracted: RawRule[] = [];

  for (const candidate of candidates) {
    if (!isAgentDirective(candidate, raw.section)) {
      continue;
    }

    for (const part of splitCompoundRule(candidate)) {
      if (!isAgentDirective(part, raw.section)) {
        continue;
      }

      extracted.push({
        text: part,
        section: raw.section,
        lineStart: raw.lineStart,
        lineEnd: raw.lineEnd,
      });
    }
  }

  return extracted;
}

export function parseClaudeAgent(content: string, filePath: string): Rule[] {
  const { bodyPreservingLines } = extractInstructionFrontmatter(content);
  const lines = bodyPreservingLines.split('\n');
  const rawRules: RawRule[] = [];

  let currentSection: string | null = null;
  let inCodeFence = false;
  let paragraphLines: Array<{ text: string; lineNum: number }> = [];

  function flushParagraph(): void {
    if (paragraphLines.length === 0) return;

    const joined = paragraphLines.map((line) => line.text).join(' ').trim();
    const lineStart = paragraphLines[0].lineNum;
    const lineEnd = paragraphLines[paragraphLines.length - 1].lineNum;
    paragraphLines = [];

    rawRules.push(
      ...splitIntoCandidateRules({
        text: joined,
        section: currentSection,
        lineStart,
        lineEnd,
      }),
    );
  }

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];

    if (/^```/.test(line)) {
      if (!inCodeFence) {
        flushParagraph();
      }
      inCodeFence = !inCodeFence;
      continue;
    }

    if (inCodeFence) {
      continue;
    }

    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      currentSection = headingMatch[1].trim();
      continue;
    }

    const listMatch = line.match(/^[-*]\s+(.+)$/) ?? line.match(/^\d+\.\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      rawRules.push(
        ...splitIntoCandidateRules({
          text: listMatch[1].trim(),
          section: currentSection,
          lineStart: lineNum,
          lineEnd: lineNum,
        }),
      );
      continue;
    }

    if (line.trim() === '') {
      flushParagraph();
      continue;
    }

    if (/^\|/.test(line) || /^>/.test(line)) {
      flushParagraph();
      continue;
    }

    paragraphLines.push({ text: line.trim(), lineNum });
  }

  flushParagraph();

  const slugs = deduplicateSlugs(rawRules.map((rule) => generateSlug(rule.text)));

  return rawRules.map((raw, index) => {
    const { category, verifiability } = classifyRule(raw.text);

    return {
      id: generateRuleId(raw.text),
      slug: slugs[index],
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
