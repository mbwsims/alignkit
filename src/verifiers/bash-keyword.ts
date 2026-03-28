import type { Rule } from '../parsers/types.js';
import type { AgentAction } from '../sessions/types.js';
import type { Observation } from './types.js';

/** Known tool categories — each group contains interchangeable alternatives. */
const TOOL_CATEGORIES: string[][] = [
  ['pnpm', 'npm', 'yarn', 'bun'],
  ['jest', 'mocha', 'vitest', 'ava'],
  ['git'],
  ['docker', 'podman'],
  ['eslint', 'prettier', 'biome'],
  ['webpack', 'vite', 'turbopack', 'esbuild'],
];

/** Individual tool keywords that can appear in bash commands. */
const KNOWN_TOOLS = [
  'pnpm', 'npm', 'yarn', 'bun', 'npx',
  'jest', 'mocha', 'vitest', 'ava', 'pytest',
  'git', 'docker', 'podman',
  'eslint', 'prettier', 'biome',
  'webpack', 'vite', 'turbopack', 'esbuild',
  'prisma', 'tsc', 'node', 'deno',
  'pip', 'cargo', 'go', 'make', 'brew', 'apt',
  'next', 'nuxt', 'remix',
];

/**
 * Try to extract a "use X not Y" or "use X instead of Y" directive from the
 * rule text.  Returns `{ preferred, forbidden }` if found, otherwise `null`.
 */
function parseUseNotPattern(text: string): { preferred: string; forbidden: string } | null {
  // "use X not Y", "use X, not Y"
  const notRe = /\buse\s+(\w+)[\s,]+not\s+(\w+)/i;
  const notMatch = notRe.exec(text);
  if (notMatch) return { preferred: notMatch[1].toLowerCase(), forbidden: notMatch[2].toLowerCase() };

  // "use X instead of Y"
  const insteadRe = /\buse\s+(\w+)\s+instead\s+of\s+(\w+)/i;
  const insteadMatch = insteadRe.exec(text);
  if (insteadMatch) return { preferred: insteadMatch[1].toLowerCase(), forbidden: insteadMatch[2].toLowerCase() };

  // "prefer X over Y"
  const preferRe = /\bprefer\s+(\w+)\s+over\s+(\w+)/i;
  const preferMatch = preferRe.exec(text);
  if (preferMatch) return { preferred: preferMatch[1].toLowerCase(), forbidden: preferMatch[2].toLowerCase() };

  return null;
}

/** Return the category group that contains `tool`, or undefined. */
function findCategory(tool: string): string[] | undefined {
  return TOOL_CATEGORIES.find((cat) => cat.includes(tool.toLowerCase()));
}

/** Collect all bash command strings from the actions list. */
function bashCommands(actions: AgentAction[]): string[] {
  return actions.filter((a): a is Extract<AgentAction, { type: 'bash' }> => a.type === 'bash').map((a) => a.command);
}

/** Check whether a command string contains a tool keyword. */
function commandMentions(cmd: string, tool: string): boolean {
  const re = new RegExp(`\\b${tool}\\b`, 'i');
  return re.test(cmd);
}

export function verifyBashKeyword(
  rule: Rule,
  actions: AgentAction[],
  sessionId: string,
): Observation {
  const cmds = bashCommands(actions);
  const base = { ruleId: rule.id, sessionId, method: 'auto:bash-keyword' as const, confidence: 'high' as const };

  // --- "use X not Y" pattern ---
  const useNot = parseUseNotPattern(rule.text);
  if (useNot) {
    const preferredUsed = cmds.some((c) => commandMentions(c, useNot.preferred));
    const forbiddenUsed = cmds.some((c) => commandMentions(c, useNot.forbidden));

    if (!preferredUsed && !forbiddenUsed) {
      // Check broader category relevance
      const cat = findCategory(useNot.preferred) ?? findCategory(useNot.forbidden);
      if (cat) {
        const anyCatUsed = cmds.some((c) => cat.some((t) => commandMentions(c, t)));
        if (!anyCatUsed) return { ...base, relevant: false };
      }
      return { ...base, relevant: false };
    }

    return { ...base, relevant: true, followed: preferredUsed && !forbiddenUsed };
  }

  // --- Generic "use X" or mentions a single tool ---
  const lowerText = rule.text.toLowerCase();

  // First check category-based tools (can verify preferred vs forbidden)
  for (const cat of TOOL_CATEGORIES) {
    for (const tool of cat) {
      if (lowerText.includes(tool)) {
        const anyCatUsed = cmds.some((c) => cat.some((t) => commandMentions(c, t)));
        if (!anyCatUsed) return { ...base, relevant: false };

        const toolUsed = cmds.some((c) => commandMentions(c, tool));
        return { ...base, relevant: true, followed: toolUsed };
      }
    }
  }

  // Fallback: check individual tool keywords not in a category
  // For these we can only verify "was this tool used?" not "was the right tool used?"
  for (const tool of KNOWN_TOOLS) {
    if (lowerText.includes(tool)) {
      const toolUsed = cmds.some((c) => commandMentions(c, tool));
      if (toolUsed) {
        return { ...base, relevant: true, followed: true };
      }
      // Tool mentioned in rule but not used — only relevant if session had related commands
      // (avoid marking as "violated" just because the tool wasn't needed in this session)
      return { ...base, relevant: false };
    }
  }

  // Also check for backtick-wrapped commands in rule text: `pnpm test`, `npx prisma`
  const backtickCmd = rule.text.match(/`([^`]+)`/);
  if (backtickCmd) {
    const cmdText = backtickCmd[1].trim().split(/\s+/)[0]; // first word
    if (cmdText && cmds.some((c) => commandMentions(c, cmdText))) {
      return { ...base, relevant: true, followed: true };
    }
  }

  return { ...base, relevant: false };
}
