import type { Rule } from './types.js';
import { parseMarkdown } from './markdown-parser.js';

export function parseCursorrules(content: string, filePath: string): Rule[] {
  return parseMarkdown(content, filePath);
}
