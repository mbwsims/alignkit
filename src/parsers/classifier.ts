import type { RuleCategory, Verifiability } from './types.js';

const PATTERNS: Array<{ category: RuleCategory; pattern: RegExp }> = [
  {
    category: 'tool-constraint',
    pattern:
      /\b(pnpm|npm|yarn|bun|npx|pip|brew|apt|cargo|go |make|git|docker|podman|pytest|jest|vitest|mocha|eslint|prettier|biome|oxlint|stylelint|webpack|vite|turbo|nx|prisma|next|nuxt|remix|tsc|node|deno|playwright|cypress|terraform|kubectl|tailwind|storybook|commitlint|husky|typedoc|jsdoc|psql|mysql|mongosh|curl|ssh)\b/i,
  },
  {
    category: 'code-structure',
    pattern:
      /\b(named exports?|default exports?|imports?|interfaces?|class(?:es)?|async|await|strict mode|module|function|const|let|var|enum|namespace|generics?|abstraction|CommonJS|ESM|arrow function|spread operator|early returns?|nested conditionals?|composition|inheritance|factory pattern|error handl|catch\b|onError|swallow.*errors?|jsdoc|barrel\s+export|re-?export|index\s+file|return\s+type|explicit\s+return)\b|`any`|`unknown`|`type`|`interface`/i,
  },
  {
    category: 'process-ordering',
    pattern:
      /\b(before|after|first|then|prior to)\b.*\b(run|test|build|commit|deploy|lint|check|install|format|push|merge|rename|move|split|separate|regenerat)\b|\b(run|test|build|commit|deploy|lint|check|install|format|push|merge|rename|move|split|separate|regenerat)\b.*\b(before|after|first|then|prior to|separate from)\b|\b(separate from|separate\b.*\bfrom)\b/i,
  },
  {
    category: 'meta',
    pattern:
      /\b(this file|these instructions|project setup|repository|codebase|this document|this guide)\b/i,
  },
  {
    category: 'style-guidance',
    pattern:
      /\b(clean|readable|meaningful|good|proper|careful|consistent|clear|simple|concise|descriptive|idiomatic|elegant|maintainable|well-named|well-structured|focused|small)\b/i,
  },
  {
    category: 'behavioral',
    pattern:
      /\b(think|consider|ask|explain|step by step|reason|reflect)\b/i,
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
