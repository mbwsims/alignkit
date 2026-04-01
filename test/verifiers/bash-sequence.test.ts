import { describe, it, expect } from 'vitest';
import { verifyBashSequence } from '../../src/verifiers/bash-sequence.js';
import type { Rule } from '../../src/parsers/types.js';
import type { AgentAction } from '../../src/sessions/types.js';

function makeRule(text: string, overrides?: Partial<Rule>): Rule {
  return {
    id: 'rule-seq-1',
    slug: 'sequence-rule',
    text,
    source: { file: 'AGENTS.md', lineStart: 1, lineEnd: 1, section: null },
    category: 'process-ordering',
    verifiability: 'auto',
    diagnostics: [],
    ...overrides,
  };
}

function bash(command: string, timestamp: string): AgentAction {
  return { type: 'bash', command, timestamp };
}

describe('verifyBashSequence', () => {
  it('"run tests before committing" + test at T1, commit at T2 => followed: true', () => {
    const rule = makeRule('run tests before committing');
    const actions = [
      bash('vitest run', '2026-01-01T10:00:00Z'),
      bash('git commit -m "feat"', '2026-01-01T10:05:00Z'),
    ];
    const obs = verifyBashSequence(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(true);
    expect(obs).toHaveProperty('followed', true);
    expect(obs.evidence).toContain('vitest run');
    expect(obs.evidence).toContain('git commit');
  });

  it('"run tests before committing" + commit at T1, test at T2 => followed: false', () => {
    const rule = makeRule('run tests before committing');
    const actions = [
      bash('git commit -m "feat"', '2026-01-01T10:00:00Z'),
      bash('vitest run', '2026-01-01T10:05:00Z'),
    ];
    const obs = verifyBashSequence(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(true);
    expect(obs).toHaveProperty('followed', false);
  });

  it('"run tests before committing" + only commit, no test => followed: false', () => {
    const rule = makeRule('run tests before committing');
    const actions = [
      bash('git commit -m "feat"', '2026-01-01T10:00:00Z'),
    ];
    const obs = verifyBashSequence(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(true);
    expect(obs).toHaveProperty('followed', false);
  });

  it('"run tests before committing" + no test or commit => relevant: false', () => {
    const rule = makeRule('run tests before committing');
    const actions = [
      bash('echo hello', '2026-01-01T10:00:00Z'),
    ];
    const obs = verifyBashSequence(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(false);
  });

  it('"lint after testing" + test at T1, lint at T2 => followed: true', () => {
    const rule = makeRule('lint after testing');
    const actions = [
      bash('vitest run', '2026-01-01T10:00:00Z'),
      bash('eslint .', '2026-01-01T10:05:00Z'),
    ];
    const obs = verifyBashSequence(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(true);
    expect(obs).toHaveProperty('followed', true);
  });

  it('"first build then push" + build at T1, push at T2 => followed: true', () => {
    const rule = makeRule('first build then push');
    const actions = [
      bash('pnpm build', '2026-01-01T10:00:00Z'),
      bash('git push', '2026-01-01T10:05:00Z'),
    ];
    const obs = verifyBashSequence(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(true);
    expect(obs).toHaveProperty('followed', true);
  });

  it('confidence is medium', () => {
    const rule = makeRule('run tests before committing');
    const actions = [
      bash('vitest run', '2026-01-01T10:00:00Z'),
      bash('git commit -m "feat"', '2026-01-01T10:05:00Z'),
    ];
    const obs = verifyBashSequence(rule, actions, 'sess-1');
    expect(obs.confidence).toBe('medium');
  });

  it('only first action present => followed: null', () => {
    const rule = makeRule('run tests before committing');
    const actions = [
      bash('vitest run', '2026-01-01T10:00:00Z'),
    ];
    const obs = verifyBashSequence(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(true);
    expect(obs).toHaveProperty('followed', null);
  });
});
