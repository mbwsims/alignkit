import { describe, it, expect } from 'vitest';
import { generateRuleId, generateSlug, deduplicateSlugs } from '../../src/parsers/rule-id.js';

describe('generateRuleId', () => {
  it('produces a 64-character hex string (SHA-256)', () => {
    const id = generateRuleId('Use pnpm, not npm');
    expect(id).toMatch(/^[0-9a-f]{64}$/);
  });

  it('normalizes whitespace before hashing', () => {
    const a = generateRuleId('Use  pnpm,  not   npm');
    const b = generateRuleId('Use pnpm, not npm');
    expect(a).toBe(b);
  });

  it('normalizes case before hashing', () => {
    const a = generateRuleId('Use PNPM, Not NPM');
    const b = generateRuleId('use pnpm, not npm');
    expect(a).toBe(b);
  });

  it('produces different IDs for different text', () => {
    const a = generateRuleId('Use pnpm, not npm');
    const b = generateRuleId('Always commit before merging');
    expect(a).not.toBe(b);
  });
});

describe('generateSlug', () => {
  it('converts to lowercase kebab-case', () => {
    expect(generateSlug('Use pnpm, not npm')).toBe('use-pnpm-not-npm');
  });

  it('strips non-alphanumeric characters', () => {
    expect(generateSlug("Always use 'strict' mode!")).toBe('always-use-strict-mode');
  });

  it('collapses multiple hyphens', () => {
    expect(generateSlug('foo   bar---baz')).toBe('foo-bar-baz');
  });

  it('truncates to 60 characters', () => {
    const long = 'a'.repeat(70);
    const slug = generateSlug(long);
    expect(slug.length).toBeLessThanOrEqual(60);
  });

  it('trims leading and trailing hyphens', () => {
    expect(generateSlug('!hello world!')).toBe('hello-world');
  });
});

describe('deduplicateSlugs', () => {
  it('returns original slugs when no duplicates', () => {
    expect(deduplicateSlugs(['foo', 'bar', 'baz'])).toEqual(['foo', 'bar', 'baz']);
  });

  it('appends -2, -3 etc for collisions', () => {
    expect(deduplicateSlugs(['foo', 'foo', 'foo'])).toEqual(['foo', 'foo-2', 'foo-3']);
  });

  it('handles mixed duplicates and unique slugs', () => {
    expect(deduplicateSlugs(['foo', 'bar', 'foo'])).toEqual(['foo', 'bar', 'foo-2']);
  });
});
