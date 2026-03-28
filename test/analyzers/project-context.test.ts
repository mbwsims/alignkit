import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { collectProjectContext } from '../../src/analyzers/project-context.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'agentlint-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('collectProjectContext', () => {
  describe('package.json dependencies', () => {
    it('reads dependency names from dependencies and devDependencies', () => {
      writeFileSync(
        join(tmpDir, 'package.json'),
        JSON.stringify({
          dependencies: { express: '^4.18.0', lodash: '^4.17.21' },
          devDependencies: { typescript: '^5.0.0', vitest: '^1.0.0' },
        }),
      );

      const ctx = collectProjectContext(tmpDir);

      expect(ctx.dependencies).toContain('express');
      expect(ctx.dependencies).toContain('lodash');
      expect(ctx.dependencies).toContain('typescript');
      expect(ctx.dependencies).toContain('vitest');
    });

    it('does not include version strings in dependencies', () => {
      writeFileSync(
        join(tmpDir, 'package.json'),
        JSON.stringify({
          dependencies: { react: '^18.2.0' },
        }),
      );

      const ctx = collectProjectContext(tmpDir);

      expect(ctx.dependencies).toContain('react');
      // Should only be the name, not a semver string
      for (const dep of ctx.dependencies) {
        expect(dep).not.toMatch(/\^|~|>|</);
      }
    });

    it('returns empty dependencies array when package.json does not exist', () => {
      const ctx = collectProjectContext(tmpDir);
      expect(ctx.dependencies).toEqual([]);
    });

    it('returns empty dependencies when neither deps section exists', () => {
      writeFileSync(
        join(tmpDir, 'package.json'),
        JSON.stringify({ name: 'my-project', version: '1.0.0' }),
      );

      const ctx = collectProjectContext(tmpDir);
      expect(ctx.dependencies).toEqual([]);
    });
  });

  describe('tsconfig.json compilerOptions', () => {
    it('reads compilerOptions from tsconfig.json when present', () => {
      writeFileSync(
        join(tmpDir, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            strict: true,
            outDir: 'dist',
          },
          include: ['src'],
        }),
      );

      const ctx = collectProjectContext(tmpDir);

      expect(ctx.tsconfig).not.toBeNull();
      expect(ctx.tsconfig?.target).toBe('ES2022');
      expect(ctx.tsconfig?.strict).toBe(true);
      expect(ctx.tsconfig?.outDir).toBe('dist');
    });

    it('returns null tsconfig when tsconfig.json does not exist', () => {
      const ctx = collectProjectContext(tmpDir);
      expect(ctx.tsconfig).toBeNull();
    });

    it('returns null tsconfig when tsconfig.json has no compilerOptions', () => {
      writeFileSync(
        join(tmpDir, 'tsconfig.json'),
        JSON.stringify({ include: ['src'] }),
      );

      const ctx = collectProjectContext(tmpDir);
      expect(ctx.tsconfig).toBeNull();
    });
  });

  describe('directory tree', () => {
    it('builds a directory tree with file counts', () => {
      mkdirSync(join(tmpDir, 'src'));
      mkdirSync(join(tmpDir, 'test'));
      writeFileSync(join(tmpDir, 'src', 'index.ts'), '');
      writeFileSync(join(tmpDir, 'src', 'utils.ts'), '');
      writeFileSync(join(tmpDir, 'test', 'index.test.ts'), '');

      const ctx = collectProjectContext(tmpDir);

      const srcEntry = ctx.directoryTree.find((e) => e.path === 'src');
      const testEntry = ctx.directoryTree.find((e) => e.path === 'test');

      expect(srcEntry).toBeDefined();
      expect(srcEntry?.fileCount).toBe(2);
      expect(testEntry).toBeDefined();
      expect(testEntry?.fileCount).toBe(1);
    });

    it('ignores node_modules, dist, and .git directories', () => {
      mkdirSync(join(tmpDir, 'node_modules'));
      mkdirSync(join(tmpDir, 'dist'));
      mkdirSync(join(tmpDir, '.git'));
      mkdirSync(join(tmpDir, 'src'));
      writeFileSync(join(tmpDir, 'node_modules', 'some-pkg.js'), '');
      writeFileSync(join(tmpDir, 'dist', 'bundle.js'), '');
      writeFileSync(join(tmpDir, '.git', 'HEAD'), '');
      writeFileSync(join(tmpDir, 'src', 'index.ts'), '');

      const ctx = collectProjectContext(tmpDir);

      const paths = ctx.directoryTree.map((e) => e.path);
      expect(paths).not.toContain('node_modules');
      expect(paths).not.toContain('dist');
      expect(paths).not.toContain('.git');
      expect(paths).toContain('src');
    });

    it('recurses up to depth 3', () => {
      mkdirSync(join(tmpDir, 'a'));
      mkdirSync(join(tmpDir, 'a', 'b'));
      mkdirSync(join(tmpDir, 'a', 'b', 'c'));
      mkdirSync(join(tmpDir, 'a', 'b', 'c', 'd'));
      writeFileSync(join(tmpDir, 'a', 'file1.ts'), '');
      writeFileSync(join(tmpDir, 'a', 'b', 'file2.ts'), '');
      writeFileSync(join(tmpDir, 'a', 'b', 'c', 'file3.ts'), '');
      writeFileSync(join(tmpDir, 'a', 'b', 'c', 'd', 'file4.ts'), '');

      const ctx = collectProjectContext(tmpDir);

      const aEntry = ctx.directoryTree.find((e) => e.path === 'a');
      expect(aEntry).toBeDefined();

      const bEntry = aEntry?.children?.find((e) => e.path === 'a/b');
      expect(bEntry).toBeDefined();

      const cEntry = bEntry?.children?.find((e) => e.path === 'a/b/c');
      expect(cEntry).toBeDefined();

      // depth 4 should not be present
      expect(cEntry?.children).toBeUndefined();
    });

    it('returns empty directory tree for an empty directory', () => {
      const ctx = collectProjectContext(tmpDir);
      expect(ctx.directoryTree).toEqual([]);
    });
  });
});
