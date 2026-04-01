import path from 'node:path';
import type { Diagnostic, PlacementSuggestion, Rule } from '../parsers/types.js';
import { isClaudeAgentFilePath, normalizeInstructionPath } from '../parsers/instruction-paths.js';

interface HookSuggestion {
  event: string;
  reason: string;
}

interface ScopedRuleSuggestion {
  fragment: string;
}

interface SubagentSuggestion {
  task: string;
}

const GLOBAL_INSTRUCTION_BASENAMES = new Set([
  'CLAUDE.md',
  'CLAUDE.local.md',
  'AGENTS.md',
  '.cursorrules',
]);

const HOOK_PATTERNS: Array<{ pattern: RegExp; event: string; reason: string }> = [
  {
    pattern: /\b(?:after|whenever|every time).{0,40}\b(?:edit|write|modify|save)\b/i,
    event: 'PostToolUse',
    reason: 'This rule describes automation that should run after file edits.',
  },
  {
    pattern: /\b(?:before).{0,40}\b(?:edit|write|modify|delete|tool use|command|bash)\b/i,
    event: 'PreToolUse',
    reason: 'This rule describes a deterministic guardrail before tool execution.',
  },
  {
    pattern: /\b(?:block|prevent|deny).{0,60}\b(?:edit|write|modify|delete|changes?)\b/i,
    event: 'PreToolUse',
    reason: 'This rule describes a hard guardrail that should block unsafe tool actions.',
  },
  {
    pattern: /\b(?:log|record|track|count).{0,60}\b(?:command|bash|tool call|tool use)\b/i,
    event: 'PreToolUse',
    reason: 'This rule describes deterministic logging of tool activity.',
  },
  {
    pattern: /\b(?:notify|notification).{0,60}\b(?:input|permission|waiting|attention)\b/i,
    event: 'Notification',
    reason: 'This rule describes notification behavior rather than prompting guidance.',
  },
  {
    pattern: /\b(?:session start|on session start|when the session starts)\b/i,
    event: 'SessionStart',
    reason: 'This rule describes startup behavior tied to session lifecycle.',
  },
  {
    pattern: /\b(?:session end|on session end|when the session ends)\b/i,
    event: 'SessionEnd',
    reason: 'This rule describes shutdown behavior tied to session lifecycle.',
  },
];

const SUBAGENT_TASK_KEYWORDS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bdebugg?(?:ing|er)?\b/i, label: 'debugging' },
  { pattern: /\bcode review|reviewer\b/i, label: 'code review' },
  { pattern: /\bsecurity review|security audit|audit\b/i, label: 'security review' },
  { pattern: /\bperformance\b/i, label: 'performance investigation' },
  { pattern: /\bmigration|migrate\b/i, label: 'migration' },
  { pattern: /\brefactor|refactoring\b/i, label: 'refactoring' },
  { pattern: /\bincident|triage|investigate\b/i, label: 'incident investigation' },
];

function hasExistingPlacement(rule: Rule): boolean {
  return rule.diagnostics.some((diagnostic) =>
    diagnostic.code === 'PLACEMENT' || diagnostic.code === 'LINTER_JOB',
  );
}

function isGlobalInstructionSource(filePath: string, cwd?: string): boolean {
  const basename = path.basename(filePath);
  if (!GLOBAL_INSTRUCTION_BASENAMES.has(basename)) {
    return false;
  }

  if (!cwd) {
    return true;
  }

  const relative = normalizeInstructionPath(path.relative(cwd, filePath));
  return relative !== '' && !relative.startsWith('../') && !relative.includes('/');
}

function extractScopedFragment(text: string): string | null {
  const fencedMatch = text.match(/[`"]([^`"]*(?:\/|\*\.[^`"]+|\.[A-Za-z0-9*?{}-]+)[^`"]*)[`"]/);
  const candidate = fencedMatch?.[1]
    ?? text.match(/\b(?:for|in|inside|under|within)\s+(?:all\s+)?(?:files?\s+)?(?:in\s+)?([A-Za-z0-9_./*?{}-]+(?:\/|\.[A-Za-z0-9*?{}-]+)[A-Za-z0-9_./*?{}-]*)/i)?.[1]
    ?? null;

  if (!candidate) {
    return null;
  }

  const normalized = candidate.replace(/[`",.:;]+$/g, '');
  if (!/[/*.]|\/|\\/.test(normalized)) {
    return null;
  }

  return normalized;
}

function suggestScopedRule(rule: Rule, cwd?: string): ScopedRuleSuggestion | null {
  if (rule.applicability || !isGlobalInstructionSource(rule.source.file, cwd)) {
    return null;
  }

  const fragment = extractScopedFragment(rule.text);
  if (!fragment) {
    return null;
  }

  return { fragment };
}

function suggestHook(rule: Rule): HookSuggestion | null {
  if (rule.applicability) {
    return null;
  }

  const match = HOOK_PATTERNS.find(({ pattern }) => pattern.test(rule.text));
  if (!match) {
    return null;
  }

  return {
    event: match.event,
    reason: match.reason,
  };
}

function countSequenceMarkers(text: string): number {
  return [
    /\bfirst\b/i,
    /\bthen\b/i,
    /\bnext\b/i,
    /\bfinally\b/i,
    /\bstart by\b/i,
    /\bbegin by\b/i,
    /\bstep\s+\d+\b/i,
  ].filter((pattern) => pattern.test(text)).length;
}

function suggestSubagent(rule: Rule): SubagentSuggestion | null {
  if (rule.applicability || rule.text.length < 90 || isClaudeAgentFilePath(rule.source.file)) {
    return null;
  }

  const task = SUBAGENT_TASK_KEYWORDS.find(({ pattern }) => pattern.test(rule.text));
  if (!task) {
    return null;
  }

  const sequenceCount = countSequenceMarkers(rule.text);
  const hasConditionalTaskLead = /^(?:when|if|for)\b/i.test(rule.text);

  if (sequenceCount < 2 && !hasConditionalTaskLead) {
    return null;
  }

  return { task: task.label };
}

function placementDiagnostic(message: string, placement: PlacementSuggestion): Diagnostic {
  return {
    severity: 'warning',
    code: 'PLACEMENT',
    message,
    placement,
  };
}

export function advisePlacement(rules: Rule[], cwd?: string): Rule[] {
  return rules.map((rule) => {
    if (hasExistingPlacement(rule)) {
      return rule;
    }

    const hookSuggestion = suggestHook(rule);
    if (hookSuggestion) {
      return {
        ...rule,
        diagnostics: [
          ...rule.diagnostics,
          placementDiagnostic(
            `${hookSuggestion.reason} Use a ${hookSuggestion.event} hook so it runs deterministically instead of relying on prompting.`,
            {
              target: 'hook',
              confidence: 'high',
              detail: hookSuggestion.event,
            },
          ),
        ],
      };
    }

    const subagentSuggestion = suggestSubagent(rule);
    if (subagentSuggestion) {
      return {
        ...rule,
        diagnostics: [
          ...rule.diagnostics,
          placementDiagnostic(
            `This rule describes a reusable multi-step ${subagentSuggestion.task} workflow. Move it into a dedicated subagent under .claude/agents/ so Claude can delegate that task cleanly.`,
            {
              target: 'subagent',
              confidence: 'high',
              detail: '.claude/agents/',
            },
          ),
        ],
      };
    }

    const scopedRuleSuggestion = suggestScopedRule(rule, cwd);
    if (scopedRuleSuggestion) {
      return {
        ...rule,
        diagnostics: [
          ...rule.diagnostics,
          placementDiagnostic(
            `This rule appears to target only part of the codebase (${scopedRuleSuggestion.fragment}). Move it into a path-scoped rule in .claude/rules/ instead of keeping it global.`,
            {
              target: 'scoped-rule',
              confidence: 'high',
              detail: scopedRuleSuggestion.fragment,
            },
          ),
        ],
      };
    }

    return rule;
  });
}
