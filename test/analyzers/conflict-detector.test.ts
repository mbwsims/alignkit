import { describe, it, expect } from 'vitest';
import { detectConflicts } from '../../src/analyzers/conflict-detector.js';
import { makeRule } from './helpers.js';

describe('detectConflicts', () => {
  it('flags negation pair ("Always use semicolons" + "Never use semicolons" → CONFLICT)', () => {
    const rules = [
      makeRule('Always use semicolons'),
      makeRule('Never use semicolons'),
    ];
    const result = detectConflicts(rules);
    const allDiagnostics = result.flatMap((r) => r.diagnostics);
    const conflicts = allDiagnostics.filter((d) => d.code === 'CONFLICT');
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('flags tool conflicts ("Use pnpm for packages" + "Use npm for packages" → CONFLICT)', () => {
    const rules = [
      makeRule('Use pnpm for packages'),
      makeRule('Use npm for packages'),
    ];
    const result = detectConflicts(rules);
    const allDiagnostics = result.flatMap((r) => r.diagnostics);
    const conflicts = allDiagnostics.filter((d) => d.code === 'CONFLICT');
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('does NOT flag unrelated rules', () => {
    const rules = [
      makeRule('Use pnpm for packages'),
      makeRule('Write tests for all components'),
    ];
    const result = detectConflicts(rules);
    const allDiagnostics = result.flatMap((r) => r.diagnostics);
    const conflicts = allDiagnostics.filter((d) => d.code === 'CONFLICT');
    expect(conflicts.length).toBe(0);
  });

  it('conflict diagnostic has severity error', () => {
    const rules = [
      makeRule('Always use semicolons'),
      makeRule('Never use semicolons'),
    ];
    const result = detectConflicts(rules);
    const allDiagnostics = result.flatMap((r) => r.diagnostics);
    const conflict = allDiagnostics.find((d) => d.code === 'CONFLICT');
    expect(conflict?.severity).toBe('error');
  });

  it('does not mutate input rules', () => {
    const rules = [makeRule('Always use semicolons'), makeRule('Never use semicolons')];
    const original = JSON.stringify(rules);
    detectConflicts(rules);
    expect(JSON.stringify(rules)).toBe(original);
  });

  it('does NOT flag rules with same verb but different objects', () => {
    const rules = [
      makeRule('Always run brainstorming sessions before making significant architectural changes'),
      makeRule('Never run cleanup scripts on .superpowers/ without backing up session data first'),
    ];
    const result = detectConflicts(rules);
    const conflicts = result.flatMap((r) => r.diagnostics).filter((d) => d.code === 'CONFLICT');
    expect(conflicts).toHaveLength(0);
  });

  it('does NOT flag rules with same verb but different direct objects', () => {
    const rules = [
      makeRule('Always write documentation before merging'),
      makeRule('Never write production code without tests'),
    ];
    const result = detectConflicts(rules);
    const conflicts = result.flatMap((r) => r.diagnostics).filter((d) => d.code === 'CONFLICT');
    expect(conflicts).toHaveLength(0);
  });

  it('still flags rules with same verb AND same object', () => {
    const rules = [
      makeRule('Always run tests before committing'),
      makeRule('Never run tests before committing'),
    ];
    const result = detectConflicts(rules);
    const conflicts = result.flatMap((r) => r.diagnostics).filter((d) => d.code === 'CONFLICT');
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('does not flag conflicts across non-overlapping path scopes', () => {
    const rules = [
      {
        ...makeRule('Use pnpm for packages'),
        applicability: {
          kind: 'path-scoped' as const,
          patterns: ['frontend/**'],
          baseDir: '/repo',
          source: 'claude-paths' as const,
        },
      },
      {
        ...makeRule('Use npm for packages'),
        applicability: {
          kind: 'path-scoped' as const,
          patterns: ['backend/**'],
          baseDir: '/repo',
          source: 'claude-paths' as const,
        },
      },
    ];

    const result = detectConflicts(rules);
    const conflicts = result.flatMap((r) => r.diagnostics).filter((d) => d.code === 'CONFLICT');
    expect(conflicts).toHaveLength(0);
  });
});
