import { describe, it, expect } from 'vitest';
import { verifyHeuristicStructure } from '../../src/verifiers/heuristic-structure.js';
import type { Rule } from '../../src/parsers/types.js';
import type { AgentAction } from '../../src/sessions/types.js';

function makeRule(text: string): Rule {
  return {
    id: 'rule-hs-1',
    slug: 'structure-rule',
    text,
    source: { file: 'AGENTS.md', lineStart: 1, lineEnd: 1, section: null },
    category: 'code-structure',
    verifiability: 'auto',
    diagnostics: [],
  };
}

function write(filePath: string, content: string): AgentAction {
  return { type: 'write', filePath, content, timestamp: '2026-01-01T00:00:00Z' };
}

describe('verifyHeuristicStructure', () => {
  describe('named exports', () => {
    it('no default exports => followed: true', () => {
      const rule = makeRule('use named exports, no default exports');
      const actions = [write('src/utils.ts', 'export function foo() {}\nexport const bar = 1;')];
      const obs = verifyHeuristicStructure(rule, actions, 'sess-1');
      expect(obs.relevant).toBe(true);
      expect(obs).toHaveProperty('followed', true);
    });

    it('has default export => followed: false', () => {
      const rule = makeRule('use named exports, no default exports');
      const actions = [write('src/utils.ts', 'export default function foo() {}')];
      const obs = verifyHeuristicStructure(rule, actions, 'sess-1');
      expect(obs.relevant).toBe(true);
      expect(obs).toHaveProperty('followed', false);
      expect(obs.evidence).toContain('src/utils.ts');
    });

    it('no code files => relevant: false', () => {
      const rule = makeRule('use named exports');
      const actions: AgentAction[] = [
        { type: 'bash', command: 'echo hi', timestamp: '2026-01-01T00:00:00Z' },
      ];
      const obs = verifyHeuristicStructure(rule, actions, 'sess-1');
      expect(obs.relevant).toBe(false);
    });
  });

  describe('async/await', () => {
    it('has async keyword => followed: true', () => {
      const rule = makeRule('use async/await for asynchronous code');
      const actions = [write('src/api.ts', 'async function fetchData() { await fetch("/api"); }')];
      const obs = verifyHeuristicStructure(rule, actions, 'sess-1');
      expect(obs.relevant).toBe(true);
      expect(obs).toHaveProperty('followed', true);
      expect(obs.evidence).toContain('src/api.ts');
    });

    it('no async keyword => followed: false', () => {
      const rule = makeRule('use async/await');
      const actions = [write('src/api.ts', 'function fetchData() { return fetch("/api"); }')];
      const obs = verifyHeuristicStructure(rule, actions, 'sess-1');
      expect(obs.relevant).toBe(true);
      expect(obs).toHaveProperty('followed', false);
    });
  });

  describe('typescript strict', () => {
    it('strict: true in tsconfig => followed: true', () => {
      const rule = makeRule('typescript strict mode should be enabled');
      const actions = [write('tsconfig.json', '{ "compilerOptions": { "strict": true } }')];
      const obs = verifyHeuristicStructure(rule, actions, 'sess-1');
      expect(obs.relevant).toBe(true);
      expect(obs).toHaveProperty('followed', true);
      expect(obs.evidence).toContain('tsconfig.json');
    });
  });

  it('confidence is medium', () => {
    const rule = makeRule('use named exports');
    const actions = [write('src/utils.ts', 'export function foo() {}')];
    const obs = verifyHeuristicStructure(rule, actions, 'sess-1');
    expect(obs.confidence).toBe('medium');
  });

  it('unrecognized structure rule => relevant: false', () => {
    const rule = makeRule('use dependency injection');
    const actions = [write('src/utils.ts', 'export function foo() {}')];
    const obs = verifyHeuristicStructure(rule, actions, 'sess-1');
    expect(obs.relevant).toBe(false);
  });
});
