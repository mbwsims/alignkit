import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Rule } from '../../src/parsers/types.js';
import { makeRule } from './helpers.js';

// Mock the Anthropic SDK
const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: mockCreate,
    };
  },
}));

// Mock project-context
vi.mock('../../src/analyzers/project-context.js', () => ({
  collectProjectContext: vi.fn(() => ({
    dependencies: ['react', 'typescript', 'vitest'],
    tsconfig: { strict: true, target: 'ES2022' },
    directoryTree: [
      { path: 'src', fileCount: 5, children: [{ path: 'src/components', fileCount: 10 }] },
      { path: 'test', fileCount: 8 },
    ],
  })),
}));

function makeLLMResponse(content: object) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(content),
      },
    ],
  };
}

function makeLLMResponseWithCodeBlock(content: object) {
  return {
    content: [
      {
        type: 'text' as const,
        text: '```json\n' + JSON.stringify(content) + '\n```',
      },
    ],
  };
}

const validLLMResult = {
  effectiveness: [
    {
      ruleId: 'abcd1234',
      level: 'LOW',
      reason: 'Too vague to be actionable',
      suggestedRewrite: 'Use pnpm for all package installations',
    },
    {
      ruleId: 'efgh5678',
      level: 'HIGH',
      reason: 'Clear and specific directive',
    },
    {
      ruleId: 'ijkl9012',
      level: 'MEDIUM',
      reason: 'Somewhat vague',
    },
  ],
  coverageGaps: [
    {
      area: 'Error handling',
      description: 'No rules about error handling patterns',
      evidence: 'Project uses React with no error boundary guidance',
    },
  ],
  consolidation: [
    {
      ruleIds: ['abcd1234', 'ijkl9012'],
      mergedText: 'Use pnpm for all operations and keep dependencies minimal',
      tokenSavings: 15,
    },
  ],
};

describe('analyzeDeep', () => {
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

  it('returns undefined when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const { analyzeDeep } = await import('../../src/analyzers/deep-analyzer.js');

    const rules = [makeRule('Use pnpm, not npm')];
    const result = await analyzeDeep(rules, '/tmp/test');

    expect(result).toBeUndefined();
    stderrSpy.mockRestore();
  });

  it('constructs prompt with all rule texts and project context', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse(validLLMResult));

    const { analyzeDeep } = await import('../../src/analyzers/deep-analyzer.js');

    const rules = [
      makeRule('Use pnpm, not npm'),
      makeRule('Always write tests for new features'),
    ];

    await analyzeDeep(rules, '/tmp/test');

    expect(mockCreate).toHaveBeenCalledOnce();
    const callArgs = mockCreate.mock.calls[0][0];
    const prompt = callArgs.messages[0].content;

    // Check that rule texts appear in the prompt
    expect(prompt).toContain('Use pnpm, not npm');
    expect(prompt).toContain('Always write tests for new features');

    // Check that project context appears
    expect(prompt).toContain('react');
    expect(prompt).toContain('typescript');
    expect(prompt).toContain('src');
  });

  it('parses valid LLM JSON response into DeepAnalysisResult', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponse(validLLMResult));

    const { analyzeDeep } = await import('../../src/analyzers/deep-analyzer.js');

    const rules = [makeRule('Use pnpm, not npm')];
    const output = await analyzeDeep(rules, '/tmp/test');

    expect(output).toBeDefined();
    expect(output!.result.effectiveness).toHaveLength(3);
    expect(output!.result.coverageGaps).toHaveLength(1);
    expect(output!.result.consolidation).toHaveLength(1);
  });

  it('handles JSON wrapped in markdown code blocks', async () => {
    mockCreate.mockResolvedValueOnce(makeLLMResponseWithCodeBlock(validLLMResult));

    const { analyzeDeep } = await import('../../src/analyzers/deep-analyzer.js');

    const rules = [makeRule('Use pnpm, not npm')];
    const output = await analyzeDeep(rules, '/tmp/test');

    expect(output).toBeDefined();
    expect(output!.result.effectiveness).toHaveLength(3);
  });

  it('maps effectiveness results to per-rule Diagnostic objects with EFFECTIVENESS code', async () => {
    // Create rules whose IDs start with known prefixes
    const rule1 = makeRule('Be careful with state management');
    const rule1Prefix = rule1.id.slice(0, 8);

    const llmResult = {
      effectiveness: [
        {
          ruleId: rule1Prefix,
          level: 'LOW',
          reason: 'Too vague',
          suggestedRewrite: 'Use React Context for global state; use useState for local component state.',
        },
      ],
      coverageGaps: [],
      consolidation: [],
    };

    mockCreate.mockResolvedValueOnce(makeLLMResponse(llmResult));

    const { analyzeDeep } = await import('../../src/analyzers/deep-analyzer.js');

    const output = await analyzeDeep([rule1], '/tmp/test');

    expect(output).toBeDefined();
    const enrichedRule = output!.rules.find((r) => r.id === rule1.id);
    expect(enrichedRule).toBeDefined();

    const effectivenessDiag = enrichedRule!.diagnostics.find(
      (d) => d.code === 'EFFECTIVENESS',
    );
    expect(effectivenessDiag).toBeDefined();
    expect(effectivenessDiag!.severity).toBe('warning');
    expect(effectivenessDiag!.message).toContain('LOW');
  });

  it('maps rewrite suggestions to REWRITE diagnostics for rules with VAGUE diagnostics', async () => {
    const vagueRule = makeRule('Try to keep functions small');
    // Add a VAGUE diagnostic to simulate static analysis output
    vagueRule.diagnostics.push({
      severity: 'warning',
      code: 'VAGUE',
      message: 'Rule is vague. Consider rewriting with specific constraints.',
    });
    const vaguePrefix = vagueRule.id.slice(0, 8);

    const llmResult = {
      effectiveness: [
        {
          ruleId: vaguePrefix,
          level: 'LOW',
          reason: 'No definition of small',
          suggestedRewrite: 'Keep functions under 30 lines. Extract helper functions for complex logic.',
        },
      ],
      coverageGaps: [],
      consolidation: [],
    };

    mockCreate.mockResolvedValueOnce(makeLLMResponse(llmResult));

    const { analyzeDeep } = await import('../../src/analyzers/deep-analyzer.js');

    const output = await analyzeDeep([vagueRule], '/tmp/test');

    expect(output).toBeDefined();
    const enrichedRule = output!.rules.find((r) => r.id === vagueRule.id);
    expect(enrichedRule).toBeDefined();

    const rewriteDiag = enrichedRule!.diagnostics.find((d) => d.code === 'REWRITE');
    expect(rewriteDiag).toBeDefined();
    expect(rewriteDiag!.message).toContain('Keep functions under 30 lines');
  });

  it('handles malformed LLM response gracefully', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: 'This is not valid JSON at all' }],
    });

    const { analyzeDeep } = await import('../../src/analyzers/deep-analyzer.js');

    const rules = [makeRule('Use pnpm, not npm')];
    const output = await analyzeDeep(rules, '/tmp/test');

    // Should return undefined or partial result, not throw
    expect(output).toBeUndefined();
  });

  it('handles API call failure gracefully', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API rate limit exceeded'));

    const { analyzeDeep } = await import('../../src/analyzers/deep-analyzer.js');

    const rules = [makeRule('Use pnpm, not npm')];
    const output = await analyzeDeep(rules, '/tmp/test');

    expect(output).toBeUndefined();
  });

  it('does not add EFFECTIVENESS diagnostic for HIGH level rules', async () => {
    const rule = makeRule('Use pnpm, not npm');
    const rulePrefix = rule.id.slice(0, 8);

    const llmResult = {
      effectiveness: [
        {
          ruleId: rulePrefix,
          level: 'HIGH',
          reason: 'Clear and specific',
        },
      ],
      coverageGaps: [],
      consolidation: [],
    };

    mockCreate.mockResolvedValueOnce(makeLLMResponse(llmResult));

    const { analyzeDeep } = await import('../../src/analyzers/deep-analyzer.js');

    const output = await analyzeDeep([rule], '/tmp/test');

    expect(output).toBeDefined();
    const enrichedRule = output!.rules.find((r) => r.id === rule.id);
    expect(enrichedRule).toBeDefined();

    const effectivenessDiag = enrichedRule!.diagnostics.find(
      (d) => d.code === 'EFFECTIVENESS',
    );
    expect(effectivenessDiag).toBeUndefined();
  });
});
