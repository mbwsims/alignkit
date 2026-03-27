import { describe, it, expect } from 'vitest';
import { detectDuplicates } from '../../src/analyzers/duplicate-detector.js';
import { makeRule } from './helpers.js';

describe('detectDuplicates', () => {
  it('flags near-duplicate pair ("Use pnpm instead of npm" + "Always use pnpm, never npm" → REDUNDANT)', () => {
    const rules = [
      makeRule('Use pnpm instead of npm'),
      makeRule('Always use pnpm, never npm'),
    ];
    const result = detectDuplicates(rules);
    const allDiagnostics = result.flatMap((r) => r.diagnostics);
    const redundant = allDiagnostics.filter((d) => d.code === 'REDUNDANT');
    expect(redundant.length).toBeGreaterThan(0);
  });

  it('does NOT flag dissimilar rules ("Use pnpm for packages" + "Write tests for all components")', () => {
    const rules = [
      makeRule('Use pnpm for packages'),
      makeRule('Write tests for all components'),
    ];
    const result = detectDuplicates(rules);
    const allDiagnostics = result.flatMap((r) => r.diagnostics);
    const redundant = allDiagnostics.filter((d) => d.code === 'REDUNDANT');
    expect(redundant.length).toBe(0);
  });

  it('diagnostic includes the other rule text', () => {
    const rules = [
      makeRule('Use pnpm instead of npm for package installation'),
      makeRule('Always use pnpm instead of npm when installing packages'),
    ];
    const result = detectDuplicates(rules);
    const allDiagnostics = result.flatMap((r) => r.diagnostics);
    const redundant = allDiagnostics.filter((d) => d.code === 'REDUNDANT');
    expect(redundant[0].message).toBeTruthy();
  });

  it('does not mutate input rules', () => {
    const rules = [makeRule('Use pnpm instead of npm'), makeRule('Always use pnpm, never npm')];
    const original = JSON.stringify(rules);
    detectDuplicates(rules);
    expect(JSON.stringify(rules)).toBe(original);
  });
});
