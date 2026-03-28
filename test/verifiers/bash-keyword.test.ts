import { describe, it, expect } from 'vitest';
import { verifyBashKeyword } from '../../src/verifiers/bash-keyword.js';
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

describe('verifyBashKeyword', () => {
  it('"use pnpm not npm" + pnpm install => followed: true', () => {
    const rule = makeRule('use pnpm not npm');
    const actions = [bash('pnpm install')];
    const obs = verifyBashKeyword(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(true);
    expect(obs).toHaveProperty('followed', true);
  });

  it('"use pnpm not npm" + npm install => followed: false', () => {
    const rule = makeRule('use pnpm not npm');
    const actions = [bash('npm install')];
    const obs = verifyBashKeyword(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(true);
    expect(obs).toHaveProperty('followed', false);
  });

  it('"use pnpm not npm" + no package manager => relevant: false', () => {
    const rule = makeRule('use pnpm not npm');
    const actions = [bash('echo hello')];
    const obs = verifyBashKeyword(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(false);
  });

  it('"use git" + git commit => relevant: true, followed: true', () => {
    const rule = makeRule('use git for version control');
    const actions = [bash('git commit -m "fix"')];
    const obs = verifyBashKeyword(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(true);
    expect(obs).toHaveProperty('followed', true);
  });

  it('"use pnpm not npm" + both used => followed: false', () => {
    const rule = makeRule('use pnpm not npm');
    const actions = [bash('pnpm install'), bash('npm run build')];
    const obs = verifyBashKeyword(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(true);
    expect(obs).toHaveProperty('followed', false);
  });

  it('"prefer vitest over jest" + vitest run => followed: true', () => {
    const rule = makeRule('prefer vitest over jest');
    const actions = [bash('vitest run')];
    const obs = verifyBashKeyword(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(true);
    expect(obs).toHaveProperty('followed', true);
  });

  it('unrelated rule text => relevant: false', () => {
    const rule = makeRule('always write documentation');
    const actions = [bash('pnpm test')];
    const obs = verifyBashKeyword(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(false);
  });

  it('confidence is always high', () => {
    const rule = makeRule('use pnpm not npm');
    const actions = [bash('pnpm install')];
    const obs = verifyBashKeyword(rule, actions, 'sess-1');
    expect(obs.confidence).toBe('high');
  });

  it('method is auto:bash-keyword', () => {
    const rule = makeRule('use pnpm not npm');
    const actions = [bash('pnpm install')];
    const obs = verifyBashKeyword(rule, actions, 'sess-1');
    expect(obs.method).toBe('auto:bash-keyword');
  });
});
