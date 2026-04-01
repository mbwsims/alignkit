import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseInstructionFile } from '../../src/parsers/auto-detect.js';
import { validateAgentFrontmatter } from '../../src/analyzers/agent-frontmatter-validator.js';

describe('validateAgentFrontmatter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `alignkit-agent-frontmatter-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('flags missing required name and description fields', () => {
    const filePath = join(tmpDir, '.claude', 'agents', 'reviewer.md');
    mkdirSync(join(tmpDir, '.claude', 'agents'), { recursive: true });
    writeFileSync(
      filePath,
      [
        '---',
        'tools: Bash, Read',
        '---',
        '',
        'Focus on security review and check for auth regressions.',
      ].join('\n'),
    );

    const rules = parseInstructionFile(readFileSync(filePath, 'utf-8'), filePath);
    const diagnostics = validateAgentFrontmatter(filePath, rules);

    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('`name`'))).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('`description`'))).toBe(true);
  });

  it('warns when the agent name does not use lowercase hyphenated format', () => {
    const filePath = join(tmpDir, '.claude', 'agents', 'reviewer.md');
    mkdirSync(join(tmpDir, '.claude', 'agents'), { recursive: true });
    writeFileSync(
      filePath,
      [
        '---',
        'name: SecurityReviewer',
        'description: Review auth-sensitive changes.',
        '---',
        '',
        'Focus on authentication and authorization edge cases.',
      ].join('\n'),
    );

    const rules = parseInstructionFile(readFileSync(filePath, 'utf-8'), filePath);
    const diagnostics = validateAgentFrontmatter(filePath, rules);

    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('lowercase letters and hyphens'))).toBe(true);
  });
});
