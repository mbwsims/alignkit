import { describe, it, expect } from 'vitest';
import { verifyFilePattern } from '../../src/verifiers/file-pattern.js';
import type { Rule } from '../../src/parsers/types.js';
import type { AgentAction } from '../../src/sessions/types.js';

function makeRule(text: string, overrides?: Partial<Rule>): Rule {
  return {
    id: 'rule-fp-1',
    slug: 'file-pattern-rule',
    text,
    source: { file: 'AGENTS.md', lineStart: 1, lineEnd: 1, section: null },
    category: 'code-structure',
    verifiability: 'auto',
    diagnostics: [],
    ...overrides,
  };
}

function write(filePath: string, content = ''): AgentAction {
  return { type: 'write', filePath, content, timestamp: '2026-01-01T00:00:00Z' };
}

describe('verifyFilePattern', () => {
  it('"tests in __tests__/" + write to src/__tests__/foo.test.ts => followed: true', () => {
    const rule = makeRule('place tests in __tests__/ directory');
    const actions = [write('src/__tests__/foo.test.ts')];
    const obs = verifyFilePattern(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(true);
    expect(obs).toHaveProperty('followed', true);
  });

  it('"tests in __tests__/" + write to src/foo.test.ts => followed: false', () => {
    const rule = makeRule('place tests in __tests__/ directory');
    const actions = [write('src/foo.test.ts')];
    const obs = verifyFilePattern(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(true);
    expect(obs).toHaveProperty('followed', false);
  });

  it('"tests in __tests__/" + no test files written => relevant: false', () => {
    const rule = makeRule('place tests in __tests__/ directory');
    const actions = [write('src/index.ts')];
    const obs = verifyFilePattern(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(false);
  });

  it('"tests in __tests__/" + no write actions => relevant: false', () => {
    const rule = makeRule('place tests in __tests__/ directory');
    const actions: AgentAction[] = [
      { type: 'bash', command: 'echo hi', timestamp: '2026-01-01T00:00:00Z' },
    ];
    const obs = verifyFilePattern(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(false);
  });

  it('mixed test files — some in __tests__/, some not => followed: false', () => {
    const rule = makeRule('place tests in __tests__/ directory');
    const actions = [
      write('src/__tests__/foo.test.ts'),
      write('src/bar.test.ts'),
    ];
    const obs = verifyFilePattern(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(true);
    expect(obs).toHaveProperty('followed', false);
  });

  it('confidence is high', () => {
    const rule = makeRule('place tests in __tests__/ directory');
    const actions = [write('src/__tests__/foo.test.ts')];
    const obs = verifyFilePattern(rule, actions, 'sess-1');
    expect(obs.confidence).toBe('high');
  });

  it('method is auto:file-pattern', () => {
    const rule = makeRule('place tests in __tests__/ directory');
    const actions = [write('src/__tests__/foo.test.ts')];
    const obs = verifyFilePattern(rule, actions, 'sess-1');
    expect(obs.method).toBe('auto:file-pattern');
  });
});
