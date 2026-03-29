import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Rule } from '../../src/parsers/types.js';
import type { AgentAction } from '../../src/sessions/types.js';
import { generateRuleId, generateSlug } from '../../src/parsers/rule-id.js';

// Mock the Anthropic SDK
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: mockCreate,
    };
  },
}));

function makeRule(text: string): Rule {
  return {
    id: generateRuleId(text),
    slug: generateSlug(text),
    text,
    source: {
      file: 'test.md',
      lineStart: 1,
      lineEnd: 1,
      section: null,
    },
    category: 'tool-constraint',
    verifiability: 'auto',
    diagnostics: [],
  };
}

function makeLLMResponse(content: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof content === 'string' ? content : JSON.stringify(content),
      },
    ],
  };
}

const sampleActions: AgentAction[] = [
  { type: 'bash', command: 'pnpm install', exitCode: 0, timestamp: '2026-01-01T00:00:00Z' },
  { type: 'bash', command: 'pnpm test', exitCode: 0, timestamp: '2026-01-01T00:01:00Z' },
  { type: 'write', filePath: 'src/index.ts', content: 'export {};', timestamp: '2026-01-01T00:02:00Z' },
  { type: 'edit', filePath: 'src/utils.ts', oldContent: 'old', newContent: 'new', timestamp: '2026-01-01T00:03:00Z' },
];

describe('llm-judge', () => {
  const originalEnv = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    mockCreate.mockReset();
    process.env.ANTHROPIC_API_KEY = 'test-key-123';
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  describe('buildActionSummary', () => {
    it('extracts bash commands, written files, and edited files', async () => {
      const { buildActionSummary } = await import('../../src/verifiers/llm-judge.js');

      const summary = buildActionSummary(sampleActions);

      expect(summary.bashCommands).toEqual(['pnpm install', 'pnpm test']);
      expect(summary.writtenFiles).toEqual(['src/index.ts']);
      expect(summary.editedFiles).toEqual(['src/utils.ts']);
    });

    it('truncates bash commands to 120 chars', async () => {
      const { buildActionSummary } = await import('../../src/verifiers/llm-judge.js');

      const longCommand = 'a'.repeat(200);
      const actions: AgentAction[] = [
        { type: 'bash', command: longCommand, exitCode: 0, timestamp: '2026-01-01T00:00:00Z' },
      ];

      const summary = buildActionSummary(actions);

      expect(summary.bashCommands[0]).toHaveLength(120);
    });

    it('caps bash commands at 50', async () => {
      const { buildActionSummary } = await import('../../src/verifiers/llm-judge.js');

      const actions: AgentAction[] = Array.from({ length: 60 }, (_, i) => ({
        type: 'bash' as const,
        command: `cmd-${i}`,
        exitCode: 0,
        timestamp: '2026-01-01T00:00:00Z',
      }));

      const summary = buildActionSummary(actions);

      expect(summary.bashCommands).toHaveLength(50);
    });
  });

  describe('buildPrompt', () => {
    it('includes rule texts with 8-char id prefixes', async () => {
      const { buildPrompt, buildActionSummary } = await import('../../src/verifiers/llm-judge.js');

      const rules = [makeRule('Use pnpm, not npm'), makeRule('Write tests for new features')];
      const summary = buildActionSummary(sampleActions);
      const prompt = buildPrompt(rules, summary);

      expect(prompt).toContain('Use pnpm, not npm');
      expect(prompt).toContain('Write tests for new features');
      expect(prompt).toContain(rules[0].id.slice(0, 8));
      expect(prompt).toContain(rules[1].id.slice(0, 8));
    });

    it('includes action summaries in the prompt', async () => {
      const { buildPrompt, buildActionSummary } = await import('../../src/verifiers/llm-judge.js');

      const rules = [makeRule('Use pnpm')];
      const summary = buildActionSummary(sampleActions);
      const prompt = buildPrompt(rules, summary);

      expect(prompt).toContain('pnpm install');
      expect(prompt).toContain('pnpm test');
      expect(prompt).toContain('src/index.ts');
      expect(prompt).toContain('src/utils.ts');
    });

    it('shows (none) when no actions of a type exist', async () => {
      const { buildPrompt, buildActionSummary } = await import('../../src/verifiers/llm-judge.js');

      const rules = [makeRule('Use pnpm')];
      const summary = buildActionSummary([]);
      const prompt = buildPrompt(rules, summary);

      expect(prompt).toContain('(none)');
    });
  });

  describe('parseResponse', () => {
    it('parses valid JSON array response', async () => {
      const { parseResponse } = await import('../../src/verifiers/llm-judge.js');

      const rule = makeRule('Use pnpm');
      const prefix = rule.id.slice(0, 8);

      const response = JSON.stringify([
        { ruleId: prefix, relevant: true, followed: true, evidence: 'Used pnpm install' },
      ]);

      const result = parseResponse(response, [rule]);

      expect(result).toHaveLength(1);
      expect(result[0].ruleId).toBe(prefix);
      expect(result[0].relevant).toBe(true);
      expect(result[0].followed).toBe(true);
    });

    it('handles JSON wrapped in markdown code blocks', async () => {
      const { parseResponse } = await import('../../src/verifiers/llm-judge.js');

      const rule = makeRule('Use pnpm');
      const prefix = rule.id.slice(0, 8);

      const response = '```json\n' + JSON.stringify([
        { ruleId: prefix, relevant: false, followed: null, evidence: 'No relevant actions' },
      ]) + '\n```';

      const result = parseResponse(response, [rule]);

      expect(result).toHaveLength(1);
      expect(result[0].relevant).toBe(false);
    });

    it('filters out unknown ruleIds', async () => {
      const { parseResponse } = await import('../../src/verifiers/llm-judge.js');

      const rule = makeRule('Use pnpm');

      const response = JSON.stringify([
        { ruleId: 'unknown1', relevant: true, followed: true, evidence: 'Something' },
        { ruleId: rule.id.slice(0, 8), relevant: true, followed: true, evidence: 'Used pnpm' },
      ]);

      const result = parseResponse(response, [rule]);

      expect(result).toHaveLength(1);
      expect(result[0].ruleId).toBe(rule.id.slice(0, 8));
    });

    it('throws on invalid JSON', async () => {
      const { parseResponse } = await import('../../src/verifiers/llm-judge.js');

      expect(() => parseResponse('not json', [makeRule('test')])).toThrow();
    });

    it('throws on non-array JSON', async () => {
      const { parseResponse } = await import('../../src/verifiers/llm-judge.js');

      expect(() => parseResponse('{"foo": "bar"}', [makeRule('test')])).toThrow('not a JSON array');
    });
  });

  describe('mapToObservations', () => {
    it('maps relevant+followed judgment to observation', async () => {
      const { mapToObservations } = await import('../../src/verifiers/llm-judge.js');

      const rule = makeRule('Use pnpm');
      const prefix = rule.id.slice(0, 8);

      const observations = mapToObservations(
        [{ ruleId: prefix, relevant: true, followed: true, evidence: 'Used pnpm' }],
        [rule],
        'session-1',
      );

      expect(observations).toHaveLength(1);
      expect(observations[0]).toEqual({
        ruleId: rule.id,
        sessionId: 'session-1',
        relevant: true,
        followed: true,
        method: 'llm-judge',
        confidence: 'medium',
      });
    });

    it('maps not-relevant judgment to observation', async () => {
      const { mapToObservations } = await import('../../src/verifiers/llm-judge.js');

      const rule = makeRule('Use pnpm');
      const prefix = rule.id.slice(0, 8);

      const observations = mapToObservations(
        [{ ruleId: prefix, relevant: false, followed: null, evidence: 'No relevant actions' }],
        [rule],
        'session-1',
      );

      expect(observations).toHaveLength(1);
      expect(observations[0]).toEqual({
        ruleId: rule.id,
        sessionId: 'session-1',
        relevant: false,
        method: 'llm-judge',
        confidence: 'medium',
      });
    });

    it('uses full rule id from rule map, not the prefix', async () => {
      const { mapToObservations } = await import('../../src/verifiers/llm-judge.js');

      const rule = makeRule('Use pnpm');
      const prefix = rule.id.slice(0, 8);

      const observations = mapToObservations(
        [{ ruleId: prefix, relevant: true, followed: null, evidence: 'Inconclusive' }],
        [rule],
        'session-1',
      );

      expect(observations[0].ruleId).toBe(rule.id);
      expect(observations[0].ruleId).not.toBe(prefix);
    });
  });

  describe('verifyWithLLM', () => {
    it('returns empty array when ANTHROPIC_API_KEY is not set', async () => {
      delete process.env.ANTHROPIC_API_KEY;

      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const { verifyWithLLM } = await import('../../src/verifiers/llm-judge.js');

      const result = await verifyWithLLM([makeRule('Use pnpm')], sampleActions, 'session-1');

      expect(result).toEqual([]);
      stderrSpy.mockRestore();
    });

    it('returns empty array when no rules provided', async () => {
      const { verifyWithLLM } = await import('../../src/verifiers/llm-judge.js');

      const result = await verifyWithLLM([], sampleActions, 'session-1');

      expect(result).toEqual([]);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('calls Anthropic API and returns observations', async () => {
      const rule = makeRule('Use pnpm, not npm');
      const prefix = rule.id.slice(0, 8);

      mockCreate.mockResolvedValueOnce(makeLLMResponse([
        { ruleId: prefix, relevant: true, followed: true, evidence: 'Used pnpm install command' },
      ]));

      const { verifyWithLLM } = await import('../../src/verifiers/llm-judge.js');

      const result = await verifyWithLLM([rule], sampleActions, 'session-1');

      expect(mockCreate).toHaveBeenCalledOnce();
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        ruleId: rule.id,
        sessionId: 'session-1',
        relevant: true,
        followed: true,
        method: 'llm-judge',
        confidence: 'medium',
      });
    });

    it('sends correct model and prompt structure', async () => {
      const rule = makeRule('Always write tests');
      const prefix = rule.id.slice(0, 8);

      mockCreate.mockResolvedValueOnce(makeLLMResponse([
        { ruleId: prefix, relevant: false, followed: null, evidence: 'No test actions' },
      ]));

      const { verifyWithLLM } = await import('../../src/verifiers/llm-judge.js');

      await verifyWithLLM([rule], sampleActions, 'session-1');

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.model).toBe('claude-sonnet-4-20250514');
      expect(callArgs.max_tokens).toBe(4096);
      expect(callArgs.messages[0].content).toContain('Always write tests');
      expect(callArgs.messages[0].content).toContain('pnpm install');
    });

    it('returns empty array on API error', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API rate limit exceeded'));

      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const { verifyWithLLM } = await import('../../src/verifiers/llm-judge.js');

      const result = await verifyWithLLM([makeRule('Use pnpm')], sampleActions, 'session-1');

      expect(result).toEqual([]);
      stderrSpy.mockRestore();
    });

    it('returns empty array on malformed LLM response', async () => {
      mockCreate.mockResolvedValueOnce(makeLLMResponse('This is not valid JSON'));

      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      const { verifyWithLLM } = await import('../../src/verifiers/llm-judge.js');

      const result = await verifyWithLLM([makeRule('Use pnpm')], sampleActions, 'session-1');

      expect(result).toEqual([]);
      stderrSpy.mockRestore();
    });
  });
});
