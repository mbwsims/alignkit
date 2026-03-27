import type { RuleCategory, Verifiability } from './types.js';

const PATTERNS: Array<{ category: RuleCategory; pattern: RegExp }> = [
  {
    category: 'tool-constraint',
    pattern:
      /\b(pnpm|npm|yarn|bun|git|docker|pytest|jest|vitest|eslint|prettier|webpack|vite|turbo|nx)\b/i,
  },
  {
    category: 'code-structure',
    pattern:
      /\b(exports?|imports?|types?|interfaces?|class|async|strict|module|function|const|let|var|enum|namespace|generic|abstraction)\b/i,
  },
  {
    category: 'process-ordering',
    pattern:
      /\b(before|after|first|then|prior to)\b.*\b(run|test|build|commit|deploy|lint|check|install|format)\b|\b(run|test|build|commit|deploy|lint|check|install|format)\b.*\b(before|after|first|then|prior to)\b/i,
  },
  {
    category: 'meta',
    pattern:
      /\b(this file|these instructions|project setup|repository|codebase|this document|this guide)\b/i,
  },
  {
    category: 'style-guidance',
    pattern:
      /\b(clean|readable|meaningful|good|proper|careful|consistent|clear|simple|concise|descriptive|idiomatic|elegant|maintainable|well-named|well-structured)\b/i,
  },
  {
    category: 'behavioral',
    pattern:
      /\b(think|consider|ask|explain|step by step|reason|reflect|analyze|decide|evaluate|assess|plan|approach|handle|address)\b/i,
  },
];

const VERIFIABILITY_MAP: Record<RuleCategory, Verifiability> = {
  'tool-constraint': 'auto',
  'code-structure': 'auto',
  'process-ordering': 'auto',
  'style-guidance': 'unverifiable',
  behavioral: 'unverifiable',
  meta: 'user-config',
};

export function classifyRule(text: string): {
  category: RuleCategory;
  verifiability: Verifiability;
} {
  for (const { category, pattern } of PATTERNS) {
    if (pattern.test(text)) {
      return { category, verifiability: VERIFIABILITY_MAP[category] };
    }
  }

  return { category: 'behavioral', verifiability: 'unverifiable' };
}
