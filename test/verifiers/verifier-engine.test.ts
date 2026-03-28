import { describe, it, expect } from 'vitest';
import { verifySession } from '../../src/verifiers/verifier-engine.js';
import { autoMap } from '../../src/verifiers/auto-mapper.js';
import type { Rule } from '../../src/parsers/types.js';
import type { AgentAction } from '../../src/sessions/types.js';

function makeRule(text: string, overrides?: Partial<Rule>): Rule {
  return {
    id: 'rule-1',
    slug: 'test-rule',
    text,
    source: { file: 'AGENTS.md', lineStart: 1, lineEnd: 1, section: null },
    category: 'tool-constraint',
    verifiability: 'auto',
    diagnostics: [],
    ...overrides,
  };
}

function bash(command: string, timestamp = '2026-01-01T00:00:00Z'): AgentAction {
  return { type: 'bash', command, timestamp };
}

describe('autoMap', () => {
  it('maps tool-constraint rules to bash-keyword', () => {
    const rule = makeRule('use pnpm not npm', { category: 'tool-constraint' });
    const fn = autoMap(rule);
    expect(fn).not.toBeNull();
  });

  it('maps code-structure rules to heuristic-structure', () => {
    const rule = makeRule('use named exports', { category: 'code-structure' });
    const fn = autoMap(rule);
    expect(fn).not.toBeNull();
  });

  it('maps process-ordering rules to bash-sequence', () => {
    const rule = makeRule('run tests before committing', { category: 'process-ordering' });
    const fn = autoMap(rule);
    expect(fn).not.toBeNull();
  });

  it('returns null for unverifiable rules', () => {
    const rule = makeRule('be creative', { verifiability: 'unverifiable' });
    const fn = autoMap(rule);
    expect(fn).toBeNull();
  });

  it('detects file-pattern signals in text', () => {
    const rule = makeRule('place tests in __tests__/ directory', { category: 'style-guidance' });
    const fn = autoMap(rule);
    expect(fn).not.toBeNull();
  });

  it('detects ordering signals even for non-process-ordering category', () => {
    const rule = makeRule('always lint before pushing', { category: 'behavioral' });
    const fn = autoMap(rule);
    expect(fn).not.toBeNull();
  });
});

describe('verifySession', () => {
  it('returns unmapped observation for unverifiable rules', () => {
    const rules = [makeRule('be creative and helpful', { id: 'r-unv', verifiability: 'unverifiable' })];
    const actions = [bash('echo hello')];
    const results = verifySession(rules, actions, 'sess-1');
    expect(results).toHaveLength(1);
    expect(results[0].method).toBe('unmapped');
    expect(results[0].relevant).toBe(false);
    expect(results[0].confidence).toBe('low');
  });

  it('verifies a tool-constraint rule correctly', () => {
    const rules = [makeRule('use pnpm not npm', { id: 'r-tool' })];
    const actions = [bash('pnpm install')];
    const results = verifySession(rules, actions, 'sess-1');
    expect(results).toHaveLength(1);
    expect(results[0].method).toBe('auto:bash-keyword');
    expect(results[0].relevant).toBe(true);
    expect(results[0]).toHaveProperty('followed', true);
  });

  it('handles mixed rule types in a single session', () => {
    const rules = [
      makeRule('use pnpm not npm', { id: 'r-1', category: 'tool-constraint' }),
      makeRule('be creative', { id: 'r-2', verifiability: 'unverifiable' }),
      makeRule('run tests before committing', { id: 'r-3', category: 'process-ordering' }),
    ];
    const actions = [
      bash('pnpm install', '2026-01-01T10:00:00Z'),
      bash('vitest run', '2026-01-01T10:01:00Z'),
      bash('git commit -m "feat"', '2026-01-01T10:02:00Z'),
    ];
    const results = verifySession(rules, actions, 'sess-1');
    expect(results).toHaveLength(3);

    // tool-constraint → bash-keyword
    expect(results[0].method).toBe('auto:bash-keyword');

    // unverifiable → unmapped
    expect(results[1].method).toBe('unmapped');

    // process-ordering → bash-sequence
    expect(results[2].method).toBe('auto:bash-sequence');
  });

  it('preserves rule and session IDs in observations', () => {
    const rules = [makeRule('use git', { id: 'rule-git' })];
    const actions = [bash('git status')];
    const results = verifySession(rules, actions, 'my-session');
    expect(results[0].ruleId).toBe('rule-git');
    expect(results[0].sessionId).toBe('my-session');
  });
});
