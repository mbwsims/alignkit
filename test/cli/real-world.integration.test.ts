import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const CLI_PATH = path.join(ROOT, 'dist/cli/index.js');
const FIXTURE = path.join(ROOT, 'test/fixtures/real-world.md');

function runCli(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      cwd: ROOT,
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

describe('real-world CLAUDE.md integration', () => {
  it('parses without crashing and exits 0', () => {
    const { status } = runCli(['lint', FIXTURE]);
    expect(status).toBe(0);
  });

  it('produces a reasonable rule count (only directives, not documentation)', () => {
    const { stdout, status } = runCli(['lint', FIXTURE, '--format', 'json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    // The fixture has ~6 actual conventions/directives, not 19 documentation items
    expect(parsed.ruleCount).toBeGreaterThan(1);
    expect(parsed.ruleCount).toBeLessThan(20);
  });

  it('produces a non-zero token count', () => {
    const { stdout, status } = runCli(['lint', FIXTURE, '--format', 'json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    // Token count is for the FULL file, not just extracted rules
    expect(parsed.tokenAnalysis.tokenCount).toBeGreaterThan(0);
  });

  it('terminal output contains "rules", "tokens", and "HEALTH"', () => {
    const { stdout, status } = runCli(['lint', FIXTURE]);
    expect(status).toBe(0);
    expect(stdout.toLowerCase()).toMatch(/rules/);
    expect(stdout.toLowerCase()).toMatch(/tokens/);
    expect(stdout).toMatch(/HEALTH/);
  });

  it('JSON output is valid and has expected structure', () => {
    const { stdout, status } = runCli(['lint', FIXTURE, '--format', 'json']);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed).toHaveProperty('file');
    expect(parsed).toHaveProperty('ruleCount');
    expect(parsed).toHaveProperty('tokenAnalysis');
    expect(parsed).toHaveProperty('diagnostics');
    expect(parsed).toHaveProperty('rules');
    expect(Array.isArray(parsed.rules)).toBe(true);
    expect(parsed.tokenAnalysis).toHaveProperty('tokenCount');
    expect(parsed.tokenAnalysis).toHaveProperty('contextWindowPercent');
    expect(parsed.tokenAnalysis).toHaveProperty('overBudget');
  });
});
