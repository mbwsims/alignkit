import type { Rule } from './types.js';
import { parseMarkdown } from './markdown-parser.js';
import { extractInstructionFrontmatter } from './frontmatter.js';
import { applyRuleApplicability, getInstructionFileApplicability } from './rule-applicability.js';

function hasMarkdownStructure(content: string): boolean {
  return /(^#{1,6}\s)|(^[-*]\s)|(^\d+\.\s)|(^```)/m.test(content);
}

export function parseCursorrules(content: string, filePath: string, cwd?: string): Rule[] {
  const normalized = extractInstructionFrontmatter(content).bodyPreservingLines;

  const parsed = hasMarkdownStructure(normalized)
    ? parseMarkdown(normalized, filePath)
    : parseMarkdown(
        [
          '# Rules',
          '',
          ...normalized
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0 && !line.startsWith('//'))
            .map((line) => `- ${line}`),
          '',
        ].join('\n'),
        filePath,
      );

  return applyRuleApplicability(
    parsed,
    getInstructionFileApplicability(filePath, content, cwd),
  );
}
