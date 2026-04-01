import type { Rule } from './types.js';
import { parseMarkdown } from './markdown-parser.js';

function stripFrontmatterPreserveLines(content: string): string {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') {
    return content;
  }

  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    return content;
  }

  const preservedPrefix = lines
    .slice(0, closingIndex + 1)
    .map(() => '')
    .join('\n');

  return preservedPrefix + '\n' + lines.slice(closingIndex + 1).join('\n');
}

function hasMarkdownStructure(content: string): boolean {
  return /(^#{1,6}\s)|(^[-*]\s)|(^\d+\.\s)|(^```)/m.test(content);
}

export function parseCursorrules(content: string, filePath: string): Rule[] {
  const normalized = stripFrontmatterPreserveLines(content);

  if (hasMarkdownStructure(normalized)) {
    return parseMarkdown(normalized, filePath);
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//'));

  const syntheticMarkdown = [
    '# Rules',
    '',
    ...lines.map((line) => `- ${line}`),
    '',
  ].join('\n');

  return parseMarkdown(syntheticMarkdown, filePath);
}
