import Anthropic from '@anthropic-ai/sdk';
import type { Rule, Diagnostic } from '../parsers/types.js';
import type { DeepAnalysisResult } from './types.js';
import {
  collectProjectContext,
  type DirectoryEntry,
} from './project-context.js';

function formatDirectoryTree(entries: DirectoryEntry[], indent = 0): string {
  const lines: string[] = [];
  for (const entry of entries) {
    const prefix = '  '.repeat(indent);
    lines.push(`${prefix}${entry.path}/ (${entry.fileCount} files)`);
    if (entry.children) {
      lines.push(formatDirectoryTree(entry.children, indent + 1));
    }
  }
  return lines.join('\n');
}

function buildPrompt(
  rules: Rule[],
  context: ReturnType<typeof collectProjectContext>,
  vagueRules: Rule[],
): string {
  return `You are an expert at analyzing AI coding agent instruction files (CLAUDE.md, .cursorrules, etc.) for effectiveness. Your job is to help developers write better instructions that agents will actually follow.

Analyze these rules against the project context and return JSON.

RULES (each with an ID for reference):
${rules.map((r) => `[${r.id.slice(0, 8)}] ${r.text}`).join('\n')}

PROJECT CONTEXT (from the project where this instruction file lives):
Dependencies: ${context.dependencies.length > 0 ? context.dependencies.join(', ') : '(none found)'}
TypeScript config: ${context.tsconfig ? JSON.stringify(context.tsconfig) : '(not found)'}
Directory structure:
${formatDirectoryTree(context.directoryTree)}

RULES FLAGGED AS VAGUE BY STATIC ANALYSIS:
${vagueRules.length > 0 ? vagueRules.map((r) => `[${r.id.slice(0, 8)}] ${r.text}`).join('\n') : '(none)'}

Return a JSON object with exactly these fields:
{
  "effectiveness": [
    { "ruleId": "<first 8 chars of rule ID>", "level": "HIGH|MEDIUM|LOW", "reason": "<1-2 sentence explanation>", "suggestedRewrite": "<concrete rewrite for LOW/vague rules, omit for HIGH>" }
  ],
  "coverageGaps": [
    { "area": "<short area name, 2-4 words>", "description": "<what behavior is missing and why it matters>", "evidence": "<specific files, dependencies, or patterns that suggest this gap>" }
  ],
  "consolidation": [
    { "ruleIds": ["<id1>", "<id2>"], "mergedText": "<COMPLETE merged rule text, not truncated>", "tokenSavings": <estimated tokens saved as integer> }
  ]
}

Guidelines:
- effectiveness: Assess EVERY rule. Use the project context to judge — a rule referencing a tool not in dependencies is LOW. A rule that's concrete and matches the project structure is HIGH. A vague or abstract rule is MEDIUM or LOW.
- suggestedRewrite: For LOW and vague rules, write a concrete, actionable rewrite that references actual project patterns (real directory names, real dependency names). The rewrite should be something an agent can unambiguously follow.
- coverageGaps: Identify 3-5 important behaviors NOT covered, based on the project's actual tech stack and structure. Be specific — reference real directories and dependencies you can see. Don't suggest gaps for technologies not present.
- consolidation: Find groups of related rules that can merge into fewer, stronger rules. The mergedText MUST be the complete merged rule — do NOT truncate it. Each merge should preserve all the original constraints.
- Keep reasons concise (1-2 sentences). No filler.`;
}

function extractJSON(text: string): unknown {
  // Try to extract JSON from markdown code blocks first
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

  return JSON.parse(jsonStr);
}

function validateDeepAnalysisResult(data: unknown): DeepAnalysisResult | null {
  if (typeof data !== 'object' || data === null) return null;

  const obj = data as Record<string, unknown>;

  const effectiveness = Array.isArray(obj.effectiveness) ? obj.effectiveness : [];
  const coverageGaps = Array.isArray(obj.coverageGaps) ? obj.coverageGaps : [];
  const consolidation = Array.isArray(obj.consolidation) ? obj.consolidation : [];

  // Validate effectiveness entries have required fields
  const validEffectiveness = effectiveness.filter(
    (e: unknown) =>
      typeof e === 'object' &&
      e !== null &&
      typeof (e as Record<string, unknown>).ruleId === 'string' &&
      ['HIGH', 'MEDIUM', 'LOW'].includes(
        (e as Record<string, unknown>).level as string,
      ) &&
      typeof (e as Record<string, unknown>).reason === 'string',
  ) as DeepAnalysisResult['effectiveness'];

  const validCoverageGaps = coverageGaps.filter(
    (g: unknown) =>
      typeof g === 'object' &&
      g !== null &&
      typeof (g as Record<string, unknown>).area === 'string' &&
      typeof (g as Record<string, unknown>).description === 'string',
  ) as DeepAnalysisResult['coverageGaps'];

  const validConsolidation = consolidation.filter(
    (c: unknown) =>
      typeof c === 'object' &&
      c !== null &&
      Array.isArray((c as Record<string, unknown>).ruleIds) &&
      typeof (c as Record<string, unknown>).mergedText === 'string',
  ) as DeepAnalysisResult['consolidation'];

  // Must have at least effectiveness to be useful
  if (validEffectiveness.length === 0 && validCoverageGaps.length === 0 && validConsolidation.length === 0) {
    return null;
  }

  return {
    effectiveness: validEffectiveness,
    coverageGaps: validCoverageGaps,
    consolidation: validConsolidation,
  };
}

function findRuleByIdPrefix(rules: Rule[], prefix: string): Rule | undefined {
  return rules.find((r) => r.id.startsWith(prefix));
}

function enrichRulesWithDiagnostics(
  rules: Rule[],
  result: DeepAnalysisResult,
): Rule[] {
  // Deep clone rules to avoid mutation
  const enriched: Rule[] = rules.map((r) => ({
    ...r,
    diagnostics: [...r.diagnostics],
  }));

  for (const eff of result.effectiveness) {
    const rule = findRuleByIdPrefix(enriched, eff.ruleId);
    if (!rule) continue;

    // Skip HIGH effectiveness rules -- no diagnostic needed
    if (eff.level === 'HIGH') continue;

    const effectivenessDiag: Diagnostic = {
      severity: 'warning',
      code: 'EFFECTIVENESS',
      message: `Deep analysis: ${eff.level} effectiveness — ${eff.reason}`,
    };
    rule.diagnostics.push(effectivenessDiag);

    // Add REWRITE diagnostic for LOW rules with suggestedRewrite,
    // or for any rule that already had a VAGUE diagnostic
    const isVague = rule.diagnostics.some((d) => d.code === 'VAGUE');
    if (eff.suggestedRewrite && (eff.level === 'LOW' || isVague)) {
      const rewriteDiag: Diagnostic = {
        severity: 'warning',
        code: 'REWRITE',
        message: `Suggested rewrite: ${eff.suggestedRewrite}`,
      };
      rule.diagnostics.push(rewriteDiag);
    }
  }

  return enriched;
}

export async function analyzeDeep(
  rules: Rule[],
  cwd: string,
): Promise<{ rules: Rule[]; result: DeepAnalysisResult } | undefined> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      'Warning: ANTHROPIC_API_KEY not set. Skipping deep analysis.\n',
    );
    return undefined;
  }

  const context = collectProjectContext(cwd);
  const vagueRules = rules.filter((r) =>
    r.diagnostics.some((d) => d.code === 'VAGUE'),
  );

  const prompt = buildPrompt(rules, context, vagueRules);

  let response: Anthropic.Message;
  try {
    const client = new Anthropic();
    response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (err) {
    process.stderr.write(
      `Warning: Deep analysis API call failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return undefined;
  }

  // Extract text from response
  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    process.stderr.write('Warning: Deep analysis returned no text content.\n');
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = extractJSON(textBlock.text);
  } catch {
    process.stderr.write(
      'Warning: Deep analysis returned malformed JSON. Skipping.\n',
    );
    return undefined;
  }

  const result = validateDeepAnalysisResult(parsed);
  if (!result) {
    process.stderr.write(
      'Warning: Deep analysis result did not match expected schema.\n',
    );
    return undefined;
  }

  const enrichedRules = enrichRulesWithDiagnostics(rules, result);

  return { rules: enrichedRules, result };
}
