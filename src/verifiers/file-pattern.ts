import type { Rule } from '../parsers/types.js';
import type { AgentAction } from '../sessions/types.js';
import type { Observation } from './types.js';

/** Known directory patterns extracted from rule text. */
const DIR_PATTERNS: [RegExp, string][] = [
  [/\b__tests__\/?/i, '__tests__/'],
  [/\bsrc\/?/i, 'src/'],
  [/\blib\/?/i, 'lib/'],
  [/\btest\/?/i, 'test/'],
  [/\bspec\/?/i, 'spec/'],
  [/\bcomponents\/?/i, 'components/'],
  [/\butils\/?/i, 'utils/'],
  [/\bhooks\/?/i, 'hooks/'],
  [/\bpages\/?/i, 'pages/'],
  [/\bapp\/?/i, 'app/'],
];

/** Known file extensions. */
const EXT_PATTERNS: [RegExp, string][] = [
  [/\.test\.ts\b/, '.test.ts'],
  [/\.test\.tsx\b/, '.test.tsx'],
  [/\.test\.js\b/, '.test.js'],
  [/\.spec\.ts\b/, '.spec.ts'],
  [/\.spec\.js\b/, '.spec.js'],
  [/\.tsx?\b/, '.ts'],
  [/\.jsx?\b/, '.js'],
  [/\.css\b/, '.css'],
  [/\.scss\b/, '.scss'],
  [/\.json\b/, '.json'],
  [/\.yaml\b/, '.yaml'],
  [/\.yml\b/, '.yml'],
];

/** Extract directory requirements from rule text. */
function extractDirRequirement(text: string): string | null {
  // "in __tests__/", "inside __tests__", "under __tests__"
  const inRe = /\b(?:in|inside|under|within)\s+[`"]?(\S+?)\/?[`"]?(?:\s|$|,|\.)/i;
  const m = inRe.exec(text);
  if (m) {
    const dir = m[1].replace(/[`"]/g, '');
    return dir.endsWith('/') ? dir : dir + '/';
  }

  // Check for known directories mentioned
  for (const [re, dir] of DIR_PATTERNS) {
    if (re.test(text)) return dir;
  }
  return null;
}

/** Get file paths from Write and Edit actions. */
function writeEditPaths(actions: AgentAction[]): string[] {
  return actions
    .filter((a): a is Extract<AgentAction, { type: 'write' | 'edit' }> => a.type === 'write' || a.type === 'edit')
    .map((a) => a.filePath);
}

/** Identify whether a path is a test file. */
function isTestFile(path: string): boolean {
  return /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(path);
}

export function verifyFilePattern(
  rule: Rule,
  actions: AgentAction[],
  sessionId: string,
): Observation {
  const base = { ruleId: rule.id, sessionId, method: 'auto:file-pattern' as const, confidence: 'high' as const };

  const dirReq = extractDirRequirement(rule.text);

  if (!dirReq) return { ...base, relevant: false, evidence: 'No directory requirement could be extracted from the rule text.' };

  const paths = writeEditPaths(actions);
  if (paths.length === 0) return { ...base, relevant: false, evidence: 'No file write or edit actions were observed.' };

  // Directory-based rule (e.g., "tests in __tests__/")
  const ruleIsAboutTests =
    /\btest/i.test(rule.text) && (dirReq.includes('test') || dirReq.includes('spec'));
  const relevantPaths = ruleIsAboutTests ? paths.filter(isTestFile) : paths;

  if (relevantPaths.length === 0) {
    return {
      ...base,
      relevant: false,
      evidence: `Touched files did not match the relevant file subset for ${dirReq}.`,
    };
  }

  const allMatch = relevantPaths.every((p) => p.includes(dirReq));
  return {
    ...base,
    relevant: true,
    followed: allMatch,
    evidence: relevantPaths.slice(0, 5).join(', '),
  };
}
