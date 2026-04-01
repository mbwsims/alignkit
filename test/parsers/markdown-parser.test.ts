import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseMarkdown } from '../../src/parsers/markdown-parser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', 'fixtures');

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

describe('parseMarkdown', () => {
  describe('simple.md — basic extraction', () => {
    const content = loadFixture('simple.md');
    const filePath = 'test/fixtures/simple.md';
    let rules: ReturnType<typeof parseMarkdown>;

    beforeAll(() => {
      rules = parseMarkdown(content, filePath);
    });

    it('extracts list items as rules', () => {
      const texts = rules.map((r) => r.text);
      expect(texts).toContain('Use pnpm, not npm');
    });

    it('extracts normative paragraphs as rules', () => {
      const texts = rules.map((r) => r.text);
      expect(texts).toContain(
        'Write clean, readable code that follows the project conventions.'
      );
    });

    it('records section headings', () => {
      const pnpmRule = rules.find((r) => r.text === 'Use pnpm, not npm');
      expect(pnpmRule).toBeDefined();
      expect(pnpmRule!.source.section).toBe('Tools');
    });

    it('records line numbers and file path', () => {
      rules.forEach((rule) => {
        expect(rule.source.lineStart).toBeGreaterThan(0);
        expect(rule.source.file).toBe(filePath);
      });
    });

    it('assigns valid 64-char hex IDs to all rules', () => {
      rules.forEach((rule) => {
        expect(rule.id).toMatch(/^[0-9a-f]{64}$/);
      });
    });

    it('assigns non-empty slugs to all rules', () => {
      rules.forEach((rule) => {
        expect(rule.slug.length).toBeGreaterThan(0);
      });
    });

    it('classifies the pnpm rule as tool-constraint with auto verifiability', () => {
      const pnpmRule = rules.find((r) => r.text === 'Use pnpm, not npm');
      expect(pnpmRule).toBeDefined();
      expect(pnpmRule!.category).toBe('tool-constraint');
      expect(pnpmRule!.verifiability).toBe('auto');
    });

    it('initializes diagnostics as empty array', () => {
      rules.forEach((rule) => {
        expect(rule.diagnostics).toEqual([]);
      });
    });
  });

  describe('compound-rules.md — compound rule splitting', () => {
    const content = loadFixture('compound-rules.md');
    const filePath = 'test/fixtures/compound-rules.md';
    let rules: ReturnType<typeof parseMarkdown>;

    beforeAll(() => {
      rules = parseMarkdown(content, filePath);
    });

    it('skips code fences — no "const x = 1" in output', () => {
      const texts = rules.map((r) => r.text);
      expect(texts.some((t) => t.includes('const x = 1'))).toBe(false);
    });

    it('skips explanatory paragraphs without imperative language', () => {
      const texts = rules.map((r) => r.text);
      expect(
        texts.some((t) => t.includes('This project uses React'))
      ).toBe(false);
    });

    it('splits compound rules with independent imperatives into TWO rules', () => {
      // "Use pnpm for package management. Always run tests before committing."
      // Both sentences have split-eligible verbs (Use, Always) and no conditional prefix
      const texts = rules.map((r) => r.text);
      expect(texts).toContain('Use pnpm for package management.');
      expect(texts).toContain('Always run tests before committing.');
    });

    it('keeps dependent sentences together when first starts with "When"', () => {
      // "When writing React components, prefer functional components with hooks.
      //  Use TypeScript generics for reusable utilities."
      // First sentence starts with "When" — conditional, do NOT split
      const texts = rules.map((r) => r.text);
      expect(
        texts.some((t) =>
          t.includes('When writing React components') &&
          t.includes('Use TypeScript generics')
        )
      ).toBe(true);
    });

    it('does NOT split when verbs are not in the allowed split list', () => {
      // "Ensure all functions have return types. Make sure to handle errors."
      // "Ensure" and "Make sure" are NOT in the split list (Always/Never/Use/Run/Create/Prefer)
      const texts = rules.map((r) => r.text);
      expect(
        texts.some((t) =>
          t.includes('Ensure all functions have return types') &&
          t.includes('Make sure to handle errors')
        )
      ).toBe(true);
    });
  });

  describe('documentation-heavy markdown', () => {
    it('does not treat README product copy and tables as rules', () => {
      const content = `# Tool

This tool helps you understand your rules.

## What it does

**\`lint\`** finds structural issues and suggests improvements.

| Command | Description |
|---|---|
| \`alignkit lint\` | Analyze instructions |

## Rules

- Always run tests before committing.
- Use pnpm, not npm.
`;

      const rules = parseMarkdown(content, 'README.md');
      const texts = rules.map((r) => r.text);

      expect(texts).toEqual([
        'Always run tests before committing.',
        'Use pnpm, not npm.',
      ]);
    });
  });
});
