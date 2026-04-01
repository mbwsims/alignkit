import type { Rule } from './types.js';
import { parseMarkdown } from './markdown-parser.js';
import { extractInstructionFrontmatter } from './frontmatter.js';
import { applyRuleApplicability, getInstructionFileApplicability } from './rule-applicability.js';

function hasMarkdownStructure(content: string): boolean {
  return /(^#{1,6}\s)|(^[-*]\s)|(^\d+\.\s)|(^```)/m.test(content);
}

export function parseClaudeRules(content: string, filePath: string, cwd?: string): Rule[] {
  const { bodyPreservingLines } = extractInstructionFrontmatter(content);

  const parsed = hasMarkdownStructure(bodyPreservingLines)
    ? parseMarkdown(bodyPreservingLines, filePath)
    : parseMarkdown(
        ['# Rules', '', ...bodyPreservingLines.split('\n').filter((line) => line.trim()).map((line) => `- ${line.trim()}`), ''].join('\n'),
        filePath,
      );

  return applyRuleApplicability(
    parsed,
    getInstructionFileApplicability(filePath, content, cwd),
  );
}
