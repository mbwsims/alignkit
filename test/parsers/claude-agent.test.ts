import { describe, expect, it } from 'vitest';
import { parseClaudeAgent } from '../../src/parsers/claude-agent.js';

describe('parseClaudeAgent', () => {
  it('preserves multi-line list items as a single instruction', () => {
    const content = [
      '---',
      'name: reviewer',
      'description: Review code changes carefully',
      '---',
      '',
      '## Responsibilities',
      '',
      '- Review risky migrations carefully,',
      '  especially when generated files are updated in the same change.',
    ].join('\n');

    const rules = parseClaudeAgent(content, '.claude/agents/reviewer.md');

    expect(rules).toHaveLength(1);
    expect(rules[0].text).toBe(
      'Review risky migrations carefully, especially when generated files are updated in the same change.',
    );
    expect(rules[0].source.lineStart).toBe(8);
    expect(rules[0].source.lineEnd).toBe(9);
  });

  it('ignores checklist items and keeps actionable instructions', () => {
    const content = [
      '---',
      'name: reviewer',
      'description: Review code changes carefully',
      '---',
      '',
      '## Responsibilities',
      '',
      '- [ ] Add more edge-case checks later',
      '- Focus on behavioral regressions in auth and billing flows.',
    ].join('\n');

    const rules = parseClaudeAgent(content, '.claude/agents/reviewer.md');

    expect(rules).toHaveLength(1);
    expect(rules[0].text).toBe('Focus on behavioral regressions in auth and billing flows.');
  });
});
