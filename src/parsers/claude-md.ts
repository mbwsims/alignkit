import type { Rule } from './types.js';
import { parseMarkdown } from './markdown-parser.js';

export function parseClaudeMd(content: string, filePath: string): Rule[] {
  return parseMarkdown(content, filePath);
}
