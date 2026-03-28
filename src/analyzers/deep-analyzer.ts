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
  return `You are analyzing an AI coding agent's instruction file for effectiveness.
Return your analysis as JSON matching this exact schema.

RULES (each with an ID for reference):
${rules.map((r) => `[${r.id.slice(0, 8)}] ${r.text}`).join('\n')}

PROJECT CONTEXT:
Dependencies: ${context.dependencies.join(', ')}
TypeScript config: ${JSON.stringify(context.tsconfig)}
Directory structure:
${formatDirectoryTree(context.directoryTree)}

RULES FLAGGED AS VAGUE BY STATIC ANALYSIS:
${vagueRules.length > 0 ? vagueRules.map((r) => `[${r.id.slice(0, 8)}] ${r.text}`).join('\n') : '(none)'}

Return a JSON object with exactly these fields:
{
  "effectiveness": [
    { "ruleId": "<first 8 chars of rule ID>", "level": "HIGH|MEDIUM|LOW", "reason": "<why>", "suggestedRewrite": "<optional, for LOW rules>" }
  ],
  "coverageGaps": [
    { "area": "<area name>", "description": "<what's missing>", "evidence": "<where you found it>" }
  ],
  "consolidation": [
    { "ruleIds": ["<id1>", "<id2>"], "mergedText": "<merged rule>", "tokenSavings": <number> }
  ]
}

Guidelines:
- effectiveness: assess EVERY rule. HIGH = likely followed. MEDIUM = may be followed inconsistently. LOW = unlikely to be followed (too vague, too abstract, conflicts with common patterns).
- coverageGaps: identify 2-5 important behaviors NOT covered by the rules, based on the project's tech stack and structure.
- consolidation: find groups of 2-5 related rules that could be merged into fewer, stronger rules. Estimate token savings.
- For LOW effectiveness rules, always provide a suggestedRewrite that is concrete and actionable.
- For vague rules listed above, provide suggestedRewrite informed by the project context.`;
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
