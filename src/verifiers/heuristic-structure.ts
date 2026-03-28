import type { Rule } from '../parsers/types.js';
import type { AgentAction } from '../sessions/types.js';
import type { Observation } from './types.js';

/** Code file extensions. */
const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb)$/;

/** Extract content from Write and Edit actions on code files. */
function codeWriteContents(actions: AgentAction[]): string[] {
  const results: string[] = [];
  for (const a of actions) {
    if (a.type === 'write' && CODE_EXTENSIONS.test(a.filePath)) {
      results.push(a.content);
    } else if (a.type === 'edit' && CODE_EXTENSIONS.test(a.filePath)) {
      results.push(a.newContent);
    }
  }
  return results;
}

/** Extract content from Write actions that touch config files. */
function configWriteContents(actions: AgentAction[]): string[] {
  const results: string[] = [];
  for (const a of actions) {
    if (a.type === 'write' && /tsconfig.*\.json$/.test(a.filePath)) {
      results.push(a.content);
    } else if (a.type === 'edit' && /tsconfig.*\.json$/.test(a.filePath)) {
      results.push(a.newContent);
    }
  }
  return results;
}

interface StructureCheck {
  /** Does the rule text match this check? */
  matches: (ruleText: string) => boolean;
  /** Run the heuristic against file contents. */
  verify: (actions: AgentAction[]) => { relevant: boolean; followed: boolean | null };
}

const CHECKS: StructureCheck[] = [
  {
    // "use named exports" / "no default exports" / "avoid export default"
    matches: (t) =>
      /\bnamed\s+export/i.test(t) ||
      /\bno\s+default\s+export/i.test(t) ||
      /\bavoid\s+export\s+default/i.test(t),
    verify: (actions) => {
      const contents = codeWriteContents(actions);
      if (contents.length === 0) return { relevant: false, followed: null };

      const hasDefault = contents.some((c) => /\bexport\s+default\b/.test(c));
      return { relevant: true, followed: !hasDefault };
    },
  },
  {
    // "TypeScript strict" / "strict mode"
    matches: (t) => /\bstrict\s*(mode|:?\s*true)/i.test(t) || /\btypescript\s+strict/i.test(t),
    verify: (actions) => {
      const configs = configWriteContents(actions);
      if (configs.length === 0) return { relevant: false, followed: null };

      const hasStrict = configs.some((c) => /"strict"\s*:\s*true/.test(c));
      return { relevant: true, followed: hasStrict };
    },
  },
  {
    // "use async/await" / "prefer async"
    matches: (t) => /\basync\s*\/?\s*await/i.test(t) || /\bprefer\s+async/i.test(t),
    verify: (actions) => {
      const contents = codeWriteContents(actions);
      if (contents.length === 0) return { relevant: false, followed: null };

      const hasAsync = contents.some((c) => /\basync\b/.test(c));
      return { relevant: true, followed: hasAsync };
    },
  },
  {
    // "use arrow functions" / "prefer arrow functions"
    matches: (t) => /\barrow\s+function/i.test(t),
    verify: (actions) => {
      const contents = codeWriteContents(actions);
      if (contents.length === 0) return { relevant: false, followed: null };

      const hasArrow = contents.some((c) => /=>\s*[{(]/.test(c));
      return { relevant: true, followed: hasArrow };
    },
  },
  {
    // "use const" / "prefer const over let"
    matches: (t) => /\bprefer\s+const/i.test(t) || /\buse\s+const/i.test(t),
    verify: (actions) => {
      const contents = codeWriteContents(actions);
      if (contents.length === 0) return { relevant: false, followed: null };

      const hasLet = contents.some((c) => /\blet\s+\w/.test(c));
      return { relevant: true, followed: !hasLet };
    },
  },
  {
    // "no any" / "avoid any" / "use unknown instead of any"
    matches: (t) =>
      /\bno\s+`?any`?\b/i.test(t) ||
      /\bavoid\s+`?any`?\b/i.test(t) ||
      /`any`.*`unknown`/i.test(t) ||
      /`unknown`.*`any`/i.test(t),
    verify: (actions) => {
      const contents = codeWriteContents(actions);
      if (contents.length === 0) return { relevant: false, followed: null };

      // Check for `: any`, `as any`, `<any>` patterns (not just the word "any")
      const hasAny = contents.some((c) => /:\s*any\b|as\s+any\b|<any>/.test(c));
      return { relevant: true, followed: !hasAny };
    },
  },
  {
    // "use early returns" / "avoid nested conditionals"
    matches: (t) =>
      /\bearly\s+return/i.test(t) ||
      /\bnested\s+conditional/i.test(t),
    verify: (actions) => {
      const contents = codeWriteContents(actions);
      if (contents.length === 0) return { relevant: false, followed: null };

      // Heuristic: deeply nested if/else blocks (3+ levels of indentation after if)
      const deepNesting = contents.some((c) => /^\s{8,}(if|else)\b/m.test(c));
      return { relevant: true, followed: !deepNesting };
    },
  },
  {
    // "never swallow errors" / "don't swallow errors" / error handling
    matches: (t) =>
      /\bswallow.*error/i.test(t) ||
      /\bempty\s+catch/i.test(t),
    verify: (actions) => {
      const contents = codeWriteContents(actions);
      if (contents.length === 0) return { relevant: false, followed: null };

      // Check for empty catch blocks: catch { } or catch(e) { }
      const hasEmptyCatch = contents.some((c) =>
        /catch\s*\([^)]*\)\s*\{\s*\}/s.test(c) ||
        /catch\s*\{\s*\}/s.test(c)
      );
      return { relevant: true, followed: !hasEmptyCatch };
    },
  },
  {
    // "always have onError handler" / error handler patterns
    matches: (t) =>
      /\bonError\b/.test(t) ||
      /\berror\s+handler/i.test(t) ||
      /\b\.catch\b/.test(t),
    verify: (actions) => {
      const contents = codeWriteContents(actions);
      if (contents.length === 0) return { relevant: false, followed: null };

      // Check for error handling patterns in async code
      const hasErrorHandling = contents.some((c) =>
        /\.catch\s*\(/.test(c) ||
        /onError\s*[=:]/.test(c) ||
        /catch\s*\([^)]+\)\s*\{[^}]+\}/.test(c) ||
        /try\s*\{/.test(c)
      );
      return { relevant: true, followed: hasErrorHandling };
    },
  },
  {
    // "prefer interface over type" / "use interface not type"
    matches: (t) =>
      /\binterface\b.*\btype\b/i.test(t) ||
      /\bprefer\s+`?interface/i.test(t),
    verify: (actions) => {
      const contents = codeWriteContents(actions);
      if (contents.length === 0) return { relevant: false, followed: null };

      const hasInterface = contents.some((c) => /\binterface\s+\w+/m.test(c));
      const hasTypeAlias = contents.some((c) => /\btype\s+\w+\s*=/m.test(c));
      // If both exist, that's fine (spec says except unions/intersections)
      // Only flag if type aliases exist but no interfaces
      if (!hasInterface && !hasTypeAlias) return { relevant: false, followed: null };
      return { relevant: true, followed: hasInterface };
    },
  },
  {
    // "use factory pattern" / "getMockX(overrides)"
    matches: (t) =>
      /\bfactory\s+pattern/i.test(t) ||
      /getMock\w*\(/i.test(t),
    verify: (actions) => {
      const contents = codeWriteContents(actions);
      // Only relevant for test files
      const testContents = actions
        .filter((a): a is Extract<AgentAction, { type: 'write' }> =>
          a.type === 'write' && /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(a.filePath))
        .map((a) => a.content);
      if (testContents.length === 0) return { relevant: false, followed: null };

      const hasFactory = testContents.some((c) =>
        /\bgetMock\w*\s*\(/.test(c) ||
        /\bcreate\w*Mock\s*\(/.test(c) ||
        /\bbuild\w*\s*\(.*override/i.test(c) ||
        /factory/i.test(c)
      );
      return { relevant: true, followed: hasFactory };
    },
  },
];

export function verifyHeuristicStructure(
  rule: Rule,
  actions: AgentAction[],
  sessionId: string,
): Observation {
  const base = {
    ruleId: rule.id,
    sessionId,
    method: 'auto:heuristic-structure' as const,
    confidence: 'medium' as const,
  };

  for (const check of CHECKS) {
    if (check.matches(rule.text)) {
      const result = check.verify(actions);
      if (!result.relevant) return { ...base, relevant: false };
      return { ...base, relevant: true, followed: result.followed };
    }
  }

  return { ...base, relevant: false };
}
