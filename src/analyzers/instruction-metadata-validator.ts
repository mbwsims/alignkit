import type { Diagnostic, Rule } from '../parsers/types.js';
import { validateAgentFrontmatter } from './agent-frontmatter-validator.js';
import { validateSkillFrontmatter } from './skill-frontmatter-validator.js';

export function validateInstructionMetadata(filePath: string, rules: Rule[]): Diagnostic[] {
  return [
    ...validateAgentFrontmatter(filePath, rules),
    ...validateSkillFrontmatter(filePath, rules),
  ];
}
