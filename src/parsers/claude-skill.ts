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
const CHECKLIST_PATTERN = /^\[[ xX]\]\s+/;
const LIST_CONTINUATION_PATTERN = /^(?:\s{2,}|\t+)\S/;
const SKILL_DIRECTIVE_PATTERN =
  /^(?:(?:when|if|whenever|before|after|to)\b.{0,200}\b(?:run|build|deploy|push|pull|open|start|stop|restart|generate|create|update|edit|review|analyze|inspect|verify|check|explain|document|summarize|walk through|draw|capture|isolate|write|fix|use|prefer|avoid|ensure|keep|preserve|return|include)\b|(?:run|build|deploy|push|pull|open|start|stop|restart|generate|create|update|edit|review|analyze|inspect|verify|check|explain|document|summarize|walk through|draw|capture|isolate|write|fix|use|prefer|avoid|ensure|keep|preserve|return|include|start with)\b)/i;

function isSkillDirective(text: string, section: string | null): boolean {
  return isNormativeText(text, section) || SKILL_DIRECTIVE_PATTERN.test(text.trim());
}

function isListContinuationLine(line: string): boolean {
  return LIST_CONTINUATION_PATTERN.test(line) && !/^[-*]\s+/.test(line) && !/^\d+\.\s+/.test(line);
}

interface ActiveListItem {
  textParts: string[];
  section: string | null;
  lineStart: number;
  lineEnd: number;
}

function splitIntoCandidateRules(raw: RawRule): RawRule[] {
  const normalized = raw.text.trim();
  if (!normalized || normalized.length < MIN_RULE_LENGTH) {
    return [];
  }

  const sentences = normalized
    .split(SENTENCE_BOUNDARY)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= MIN_RULE_LENGTH);

  const candidates = sentences.length > 1 ? sentences : [normalized];
  const extracted: RawRule[] = [];

  for (const candidate of candidates) {
    if (!isSkillDirective(candidate, raw.section)) {
      continue;
    }

    for (const part of splitCompoundRule(candidate)) {
      if (!isSkillDirective(part, raw.section)) {
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

export function parseClaudeSkill(content: string, filePath: string): Rule[] {
  const { bodyPreservingLines } = extractInstructionFrontmatter(content);
  const lines = bodyPreservingLines.split('\n');
  const rawRules: RawRule[] = [];

  let currentSection: string | null = null;
  let inCodeFence = false;
  let paragraphLines: Array<{ text: string; lineNum: number }> = [];
  let activeListItem: ActiveListItem | null = null;

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

  function flushActiveListItem(): void {
    if (!activeListItem) return;

    const joined = activeListItem.textParts.join(' ').trim();
    const { section, lineStart, lineEnd } = activeListItem;
    activeListItem = null;

    rawRules.push(
      ...splitIntoCandidateRules({
        text: joined,
        section,
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
        flushActiveListItem();
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
      flushActiveListItem();
      flushParagraph();
      currentSection = headingMatch[1].trim();
      continue;
    }

    const listMatch = line.match(/^[-*]\s+(.+)$/) ?? line.match(/^\d+\.\s+(.+)$/);
    if (listMatch) {
      flushActiveListItem();
      flushParagraph();
      const itemText = listMatch[1].trim();
      if (!CHECKLIST_PATTERN.test(itemText)) {
        activeListItem = {
          textParts: [itemText],
          section: currentSection,
          lineStart: lineNum,
          lineEnd: lineNum,
        };
      }
      continue;
    }

    if (line.trim() === '') {
      flushActiveListItem();
      flushParagraph();
      continue;
    }

    if (/^\|/.test(line) || /^>/.test(line)) {
      flushActiveListItem();
      flushParagraph();
      continue;
    }

    if (activeListItem && isListContinuationLine(line)) {
      activeListItem.textParts.push(line.trim());
      activeListItem.lineEnd = lineNum;
      continue;
    }

    flushActiveListItem();

    paragraphLines.push({ text: line.trim(), lineNum });
  }

  flushActiveListItem();
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
