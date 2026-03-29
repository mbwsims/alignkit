import Anthropic from '@anthropic-ai/sdk';
import type { Rule } from '../parsers/types.js';
import type { AgentAction } from '../sessions/types.js';
import type { Observation } from './types.js';

interface LLMJudgment {
  ruleId: string;
  relevant: boolean;
  followed: boolean | null;
  evidence: string;
}

function buildActionSummary(actions: AgentAction[]): {
  bashCommands: string[];
  writtenFiles: string[];
  editedFiles: string[];
} {
  const bashCommands: string[] = [];
  const writtenFiles: string[] = [];
  const editedFiles: string[] = [];

  for (const action of actions) {
    switch (action.type) {
      case 'bash':
        if (bashCommands.length < 50) {
          bashCommands.push(action.command.slice(0, 120));
        }
        break;
      case 'write':
        writtenFiles.push(action.filePath);
        break;
      case 'edit':
        editedFiles.push(action.filePath);
        break;
    }
  }

  return { bashCommands, writtenFiles, editedFiles };
}

function buildPrompt(rules: Rule[], summary: ReturnType<typeof buildActionSummary>): string {
  const ruleLines = rules.map((r, i) => `${i + 1}. [${r.id.slice(0, 8)}] ${r.text}`).join('\n');

  const commandBlock = summary.bashCommands.length > 0
    ? summary.bashCommands.join('\n')
    : '(none)';

  const writtenBlock = summary.writtenFiles.length > 0
    ? summary.writtenFiles.join('\n')
    : '(none)';

  const editedBlock = summary.editedFiles.length > 0
    ? summary.editedFiles.join('\n')
    : '(none)';

  return `You are evaluating whether an AI coding agent followed specific rules during a coding session.

RULES TO EVALUATE:
${ruleLines}

SESSION ACTIONS:
Bash commands executed:
${commandBlock}

Files written:
${writtenBlock}

Files edited:
${editedBlock}

For each rule, respond with JSON array:
[
  { "ruleId": "<8-char id prefix>", "relevant": true/false, "followed": true/false/null, "evidence": "<1-2 sentences citing specific actions>" }
]

Guidelines:
- relevant=false if the session had no actions where this rule could apply
- followed=null if relevant but evidence is inconclusive
- followed=true/false only when you have clear evidence from the actions
- Be specific: cite exact commands or file paths as evidence
- When in doubt, use followed=null rather than guessing`;
}

function parseResponse(text: string, rules: Rule[]): LLMJudgment[] {
  // Strip markdown code blocks if present
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) {
    throw new Error('LLM response is not a JSON array');
  }

  const ruleIdPrefixes = new Set(rules.map((r) => r.id.slice(0, 8)));

  return parsed.filter(
    (item: LLMJudgment) =>
      typeof item.ruleId === 'string' && ruleIdPrefixes.has(item.ruleId),
  );
}

function mapToObservations(
  judgments: LLMJudgment[],
  rules: Rule[],
  sessionId: string,
): Observation[] {
  const ruleMap = new Map(rules.map((r) => [r.id.slice(0, 8), r]));

  return judgments.map((j) => {
    const rule = ruleMap.get(j.ruleId);
    const fullRuleId = rule?.id ?? j.ruleId;

    if (!j.relevant) {
      return {
        ruleId: fullRuleId,
        sessionId,
        relevant: false as const,
        method: 'llm-judge' as const,
        confidence: 'medium' as const,
      };
    }

    return {
      ruleId: fullRuleId,
      sessionId,
      relevant: true as const,
      followed: j.followed,
      method: 'llm-judge' as const,
      confidence: 'medium' as const,
    };
  });
}

export async function verifyWithLLM(
  rules: Rule[],
  actions: AgentAction[],
  sessionId: string,
): Promise<Observation[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    process.stderr.write('ANTHROPIC_API_KEY not set. Skipping LLM evaluation.\n');
    return [];
  }

  if (rules.length === 0) {
    return [];
  }

  try {
    const client = new Anthropic();
    const summary = buildActionSummary(actions);
    const prompt = buildPrompt(rules, summary);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return [];
    }

    const judgments = parseResponse(textBlock.text, rules);
    return mapToObservations(judgments, rules, sessionId);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(`LLM judge error: ${msg}\n`);
    return [];
  }
}

// Export internals for testing
export { buildActionSummary, buildPrompt, parseResponse, mapToObservations };
