import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CLI_PATH = path.join(ROOT, 'dist/cli/index.js');
const FIXTURES_DIR = path.join(ROOT, 'test/fixtures');
const SIMPLE_MD = path.join(FIXTURES_DIR, 'simple.md');

function runCli(args: string[], cwd?: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      cwd: cwd ?? ROOT,
      encoding: 'utf-8',
    });
    return { stdout, status: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (e.stdout ?? '') + (e.stderr ?? ''),
      status: e.status ?? 1,
    };
  }
}

beforeAll(() => {
  // Build the CLI before running integration tests
  execFileSync('pnpm', ['build'], { cwd: ROOT, stdio: 'inherit' });
});

describe('lint command integration', () => {
  it('runs against simple.md and exits 0, output contains rules and tokens', () => {
    const { stdout, status } = runCli(['lint', SIMPLE_MD]);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/rules/);
    expect(stdout.toLowerCase()).toMatch(/tokens/);
  });

  it('--format json outputs valid JSON with ruleCount > 0', () => {
    const { stdout, status } = runCli(['lint', SIMPLE_MD, '--format', 'json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('ruleCount');
    expect(parsed.ruleCount).toBeGreaterThan(0);
  });

  it('--format markdown output contains # alignkit report heading or file heading', () => {
    const { stdout, status } = runCli(['lint', SIMPLE_MD, '--format', 'markdown']);
    expect(status).toBe(0);
    // Markdown reporter starts with "# <filename>"
    expect(stdout).toMatch(/^#\s/m);
  });

  it('exits with non-zero code when no instruction files found in empty temp dir', () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'alignkit-test-'));
    const { status } = runCli(['lint'], tmpDir);
    expect(status).not.toBe(0);
  });

  it('--all flag analyzes both files and output contains results for each', () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), 'alignkit-test-'));

    writeFileSync(
      path.join(tmpDir, 'CLAUDE.md'),
      '# Claude Rules\n\n- Always use TypeScript\n- Use pnpm for package management\n'
    );
    writeFileSync(
      path.join(tmpDir, 'AGENTS.md'),
      '# Agent Rules\n\n- Run tests before committing\n- Never commit secrets\n'
    );

    const { stdout, status } = runCli(['lint', '--all', '--format', 'json'], tmpDir);
    expect(status).toBe(0);

    // When --all is used, multiple JSON objects are printed (one per file)
    // We need to parse each line as a separate JSON object, or the output may be
    // concatenated JSON objects. Parse lines that start with '{'.
    const jsonBlocks = stdout
      .split(/(?<=\})\s*(?=\{)/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith('{'));

    expect(jsonBlocks.length).toBe(2);

    const first = JSON.parse(jsonBlocks[0]);
    const second = JSON.parse(jsonBlocks[1]);

    const files = [first.file, second.file];
    expect(files.some((f) => f.includes('CLAUDE.md'))).toBe(true);
    expect(files.some((f) => f.includes('AGENTS.md'))).toBe(true);
  });
});
