import { describe, expect, it } from 'vitest';
import { parseClaudeSkill } from '../../src/parsers/claude-skill.js';

describe('parseClaudeSkill', () => {
  it('strips frontmatter and preserves numbered workflow steps', () => {
    const content = [
      '---',
      'name: deploy',
      'description: Deploy the application safely.',
      'disable-model-invocation: true',
      '---',
      '',
      'Deploy the application:',
      '1. Run the test suite.',
      '2. Build the application.',
      '3. Push to the deployment target.',
    ].join('\n');

    const rules = parseClaudeSkill(content, '.claude/skills/deploy/SKILL.md');
    const texts = rules.map((rule) => rule.text);

    expect(texts).toContain('Run the test suite.');
    expect(texts).toContain('Build the application.');
    expect(texts).toContain('Push to the deployment target.');
    expect(texts.some((text) => text.includes('disable-model-invocation'))).toBe(false);
  });
});
