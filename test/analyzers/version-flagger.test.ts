import { describe, it, expect } from 'vitest';
import { flagVersions } from '../../src/analyzers/version-flagger.js';
import { makeRule } from './helpers.js';

describe('flagVersions', () => {
  it('flags "Use Tailwind v3 for styling"', () => {
    const rules = [makeRule('Use Tailwind v3 for styling')];
    const result = flagVersions(rules);
    expect(result[0].diagnostics).toHaveLength(1);
    expect(result[0].diagnostics[0].code).toBe('STALE');
  });

  it('flags "Use React 18.2 or higher"', () => {
    const rules = [makeRule('Use React 18.2 or higher')];
    const result = flagVersions(rules);
    expect(result[0].diagnostics).toHaveLength(1);
    expect(result[0].diagnostics[0].code).toBe('STALE');
  });

  it('does NOT flag "Use pnpm for packages"', () => {
    const rules = [makeRule('Use pnpm for packages')];
    const result = flagVersions(rules);
    expect(result[0].diagnostics).toHaveLength(0);
  });

  it('STALE diagnostic has severity warning', () => {
    const rules = [makeRule('Use Node v18 or higher')];
    const result = flagVersions(rules);
    expect(result[0].diagnostics[0].severity).toBe('warning');
  });

  it('does not mutate input rules', () => {
    const rules = [makeRule('Use Tailwind v3 for styling')];
    const original = JSON.stringify(rules);
    flagVersions(rules);
    expect(JSON.stringify(rules)).toBe(original);
  });
});
