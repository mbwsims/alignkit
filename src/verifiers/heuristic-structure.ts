import type { Rule } from '../parsers/types.js';
import type { AgentAction } from '../sessions/types.js';
import type { Observation } from './types.js';

/** Code file extensions. */
const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb)$/;

interface ContentFile {
  filePath: string;
  content: string;
}

/** Extract content from Write and Edit actions on code files. */
function codeWriteContents(actions: AgentAction[]): ContentFile[] {
  const results: ContentFile[] = [];
  for (const a of actions) {
    if (a.type === 'write' && CODE_EXTENSIONS.test(a.filePath)) {
      results.push({ filePath: a.filePath, content: a.content });
    } else if (a.type === 'edit' && CODE_EXTENSIONS.test(a.filePath)) {
      results.push({ filePath: a.filePath, content: a.newContent });
    }
  }
  return results;
}

/** Extract content from Write actions that touch config files. */
function configWriteContents(actions: AgentAction[]): ContentFile[] {
  const results: ContentFile[] = [];
  for (const a of actions) {
    if (a.type === 'write' && /tsconfig.*\.json$/.test(a.filePath)) {
      results.push({ filePath: a.filePath, content: a.content });
    } else if (a.type === 'edit' && /tsconfig.*\.json$/.test(a.filePath)) {
      results.push({ filePath: a.filePath, content: a.newContent });
    }
  }
  return results;
}

interface StructureCheck {
  /** Does the rule text match this check? */
  matches: (ruleText: string) => boolean;
  /** Run the heuristic against file contents. */
  verify: (actions: AgentAction[]) => {
    relevant: boolean;
    followed: boolean | null;
    evidence?: string;
  };
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
      if (contents.length === 0) {
        return { relevant: false, followed: null, evidence: 'No code files were written or edited.' };
      }

      const defaultExportFile = contents.find((file) => /\bexport\s+default\b/.test(file.content));
      return {
        relevant: true,
        followed: !defaultExportFile,
        evidence: defaultExportFile
          ? `${defaultExportFile.filePath} contains \`export default\`.`
          : `Checked ${contents.length} code file(s); no default exports found.`,
      };
    },
  },
  {
    // "TypeScript strict" / "strict mode"
    matches: (t) => /\bstrict\s*(mode|:?\s*true)/i.test(t) || /\btypescript\s+strict/i.test(t),
    verify: (actions) => {
      const configs = configWriteContents(actions);
      if (configs.length === 0) {
        return { relevant: false, followed: null, evidence: 'No tsconfig files were written or edited.' };
      }

      const strictConfig = configs.find((file) => /"strict"\s*:\s*true/.test(file.content));
      return {
        relevant: true,
        followed: strictConfig !== undefined,
        evidence: strictConfig
          ? `${strictConfig.filePath} sets \`"strict": true\`.`
          : `Checked ${configs.length} tsconfig file(s); none enabled strict mode.`,
      };
    },
  },
  {
    // "use async/await" / "prefer async"
    matches: (t) => /\basync\s*\/?\s*await/i.test(t) || /\bprefer\s+async/i.test(t),
    verify: (actions) => {
      const contents = codeWriteContents(actions);
      if (contents.length === 0) {
        return { relevant: false, followed: null, evidence: 'No code files were written or edited.' };
      }

      const asyncFile = contents.find((file) => /\basync\b/.test(file.content));
      return {
        relevant: true,
        followed: asyncFile !== undefined,
        evidence: asyncFile
          ? `${asyncFile.filePath} contains \`async\`.`
          : `Checked ${contents.length} code file(s); none used \`async\`.`,
      };
    },
  },
  {
    // "use arrow functions" / "prefer arrow functions"
    matches: (t) => /\barrow\s+function/i.test(t),
    verify: (actions) => {
      const contents = codeWriteContents(actions);
      if (contents.length === 0) {
        return { relevant: false, followed: null, evidence: 'No code files were written or edited.' };
      }

      const arrowFile = contents.find((file) => /=>\s*[{(]/.test(file.content));
      return {
        relevant: true,
        followed: arrowFile !== undefined,
        evidence: arrowFile
          ? `${arrowFile.filePath} contains an arrow function.`
          : `Checked ${contents.length} code file(s); none contained arrow functions.`,
      };
    },
  },
  {
    // "use const" / "prefer const over let"
    matches: (t) => /\bprefer\s+const/i.test(t) || /\buse\s+const/i.test(t),
    verify: (actions) => {
      const contents = codeWriteContents(actions);
      if (contents.length === 0) {
        return { relevant: false, followed: null, evidence: 'No code files were written or edited.' };
      }

      const letFile = contents.find((file) => /\blet\s+\w/.test(file.content));
      return {
        relevant: true,
        followed: !letFile,
        evidence: letFile
          ? `${letFile.filePath} contains \`let\`.`
          : `Checked ${contents.length} code file(s); no \`let\` declarations found.`,
      };
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
      if (contents.length === 0) {
        return { relevant: false, followed: null, evidence: 'No code files were written or edited.' };
      }

      // Check for `: any`, `as any`, `<any>` patterns (not just the word "any")
      const anyFile = contents.find((file) => /:\s*any\b|as\s+any\b|<any>/.test(file.content));
      return {
        relevant: true,
        followed: !anyFile,
        evidence: anyFile
          ? `${anyFile.filePath} contains an \`any\` type assertion or annotation.`
          : `Checked ${contents.length} code file(s); no \`any\` usage detected.`,
      };
    },
  },
  {
    // "use early returns" / "avoid nested conditionals"
    matches: (t) =>
      /\bearly\s+return/i.test(t) ||
      /\bnested\s+conditional/i.test(t),
    verify: (actions) => {
      const contents = codeWriteContents(actions);
      if (contents.length === 0) {
        return { relevant: false, followed: null, evidence: 'No code files were written or edited.' };
      }

      // Heuristic: deeply nested if/else blocks (3+ levels of indentation after if)
      const nestedFile = contents.find((file) => /^\s{8,}(if|else)\b/m.test(file.content));
      return {
        relevant: true,
        followed: !nestedFile,
        evidence: nestedFile
          ? `${nestedFile.filePath} contains deeply nested conditionals.`
          : `Checked ${contents.length} code file(s); no deep conditional nesting detected.`,
      };
    },
  },
  {
    // "never swallow errors" / "don't swallow errors" / error handling
    matches: (t) =>
      /\bswallow.*error/i.test(t) ||
      /\bempty\s+catch/i.test(t),
    verify: (actions) => {
      const contents = codeWriteContents(actions);
      if (contents.length === 0) {
        return { relevant: false, followed: null, evidence: 'No code files were written or edited.' };
      }

      // Check for empty catch blocks: catch { } or catch(e) { }
      const emptyCatchFile = contents.find((file) =>
        /catch\s*\([^)]*\)\s*\{\s*\}/s.test(file.content) ||
        /catch\s*\{\s*\}/s.test(file.content)
      );
      return {
        relevant: true,
        followed: !emptyCatchFile,
        evidence: emptyCatchFile
          ? `${emptyCatchFile.filePath} contains an empty catch block.`
          : `Checked ${contents.length} code file(s); no empty catch blocks found.`,
      };
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
      if (contents.length === 0) {
        return { relevant: false, followed: null, evidence: 'No code files were written or edited.' };
      }

      // Check for error handling patterns in async code
      const errorHandlingFile = contents.find((file) =>
        /\.catch\s*\(/.test(file.content) ||
        /onError\s*[=:]/.test(file.content) ||
        /catch\s*\([^)]+\)\s*\{[^}]+\}/.test(file.content) ||
        /try\s*\{/.test(file.content)
      );
      return {
        relevant: true,
        followed: errorHandlingFile !== undefined,
        evidence: errorHandlingFile
          ? `${errorHandlingFile.filePath} contains explicit error handling.`
          : `Checked ${contents.length} code file(s); no explicit error handling patterns found.`,
      };
    },
  },
  {
    // "prefer interface over type" / "use interface not type"
    matches: (t) =>
      /\binterface\b.*\btype\b/i.test(t) ||
      /\bprefer\s+`?interface/i.test(t),
    verify: (actions) => {
      const contents = codeWriteContents(actions);
      if (contents.length === 0) {
        return { relevant: false, followed: null, evidence: 'No code files were written or edited.' };
      }

      const interfaceFile = contents.find((file) => /\binterface\s+\w+/m.test(file.content));
      const typeAliasFile = contents.find((file) => /\btype\s+\w+\s*=/m.test(file.content));
      // If both exist, that's fine (spec says except unions/intersections)
      // Only flag if type aliases exist but no interfaces
      if (!interfaceFile && !typeAliasFile) {
        return { relevant: false, followed: null, evidence: 'No interface or type alias declarations were written.' };
      }
      return {
        relevant: true,
        followed: interfaceFile !== undefined,
        evidence: interfaceFile
          ? `${interfaceFile.filePath} contains an interface declaration.`
          : `${typeAliasFile?.filePath} contains a type alias without an interface declaration.`,
      };
    },
  },
  {
    // "use factory pattern" / "getMockX(overrides)"
    matches: (t) =>
      /\bfactory\s+pattern/i.test(t) ||
      /getMock\w*\(/i.test(t),
    verify: (actions) => {
      // Only relevant for test files
      const testContents = codeWriteContents(actions).filter((file) =>
        /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(file.filePath),
      );
      if (testContents.length === 0) {
        return { relevant: false, followed: null, evidence: 'No test files were written or edited.' };
      }

      const factoryFile = testContents.find((file) =>
        /\bgetMock\w*\s*\(/.test(file.content) ||
        /\bcreate\w*Mock\s*\(/.test(file.content) ||
        /\bbuild\w*\s*\(.*override/i.test(file.content) ||
        /factory/i.test(file.content)
      );
      return {
        relevant: true,
        followed: factoryFile !== undefined,
        evidence: factoryFile
          ? `${factoryFile.filePath} contains a mock factory pattern.`
          : `Checked ${testContents.length} test file(s); no factory helper patterns found.`,
      };
    },
  },
];

export function matchesHeuristicStructureRule(text: string): boolean {
  return CHECKS.some((check) => check.matches(text));
}

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
      if (!result.relevant) return { ...base, relevant: false, evidence: result.evidence };
      return { ...base, relevant: true, followed: result.followed, evidence: result.evidence };
    }
  }

  return { ...base, relevant: false, evidence: 'No heuristic structure check matched this rule.' };
}
