import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseInstructionFile } from '../../src/parsers/auto-detect.js';
import { validateSkillFrontmatter } from '../../src/analyzers/skill-frontmatter-validator.js';

describe('validateSkillFrontmatter', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `alignkit-skill-frontmatter-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('warns when frontmatter and description are missing', () => {
    const skillDir = join(tmpDir, '.claude', 'skills', 'explain-code');
    const filePath = join(skillDir, 'SKILL.md');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      filePath,
      [
        'When explaining code, always include an analogy and a diagram.',
      ].join('\n'),
    );

    const rules = parseInstructionFile(readFileSync(filePath, 'utf-8'), filePath);
    const diagnostics = validateSkillFrontmatter(filePath, rules);

    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('YAML frontmatter'))).toBe(true);
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('`description`'))).toBe(true);
  });

  it('warns when the effective skill name is not lowercase hyphenated', () => {
    const skillDir = join(tmpDir, '.claude', 'skills', 'ExplainCode');
    const filePath = join(skillDir, 'SKILL.md');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      filePath,
      [
        '---',
        'description: Explain code with diagrams.',
        '---',
        '',
        'Always explain code with a short analogy first.',
      ].join('\n'),
    );

    const rules = parseInstructionFile(readFileSync(filePath, 'utf-8'), filePath);
    const diagnostics = validateSkillFrontmatter(filePath, rules);

    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('lowercase letters, numbers, and hyphens'))).toBe(true);
  });

  it('warns when agent is set without context fork', () => {
    const skillDir = join(tmpDir, '.claude', 'skills', 'debug-workflow');
    const filePath = join(skillDir, 'SKILL.md');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      filePath,
      [
        '---',
        'name: debug-workflow',
        'description: Debug incidents safely.',
        'agent: debugger',
        '---',
        '',
        'When debugging incidents, first capture logs, then isolate a reproduction.',
      ].join('\n'),
    );

    const rules = parseInstructionFile(readFileSync(filePath, 'utf-8'), filePath);
    const diagnostics = validateSkillFrontmatter(filePath, rules);

    expect(diagnostics.some((diagnostic) => diagnostic.message.includes('`context: fork`'))).toBe(true);
  });
});
