import type { DetectedStack } from './stack-detector.js';
import type { TemplateRule } from './template-rules.js';
import { collectTemplateRules } from './template-rules.js';
import { collectProjectContext } from '../analyzers/project-context.js';
import type { DirectoryEntry } from '../analyzers/project-context.js';

// --- Template-based generation ---

export function generateFromTemplates(stack: DetectedStack): string {
  const rules = collectTemplateRules(stack);
  return assembleMarkdown(rules);
}

function assembleMarkdown(rules: TemplateRule[]): string {
  const sections: Record<string, string[]> = {
    commands: [],
    code: [],
    process: [],
  };

  for (const rule of rules) {
    sections[rule.section].push(rule.text);
  }

  const lines: string[] = [];

  // Code and Process first (high-priority constraints), Commands last (documentation)
  if (sections.code.length > 0) {
    lines.push('## Code');
    lines.push('');
    for (const text of sections.code) {
      lines.push(`- ${text}`);
    }
  }

  if (sections.process.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('## Process');
    lines.push('');
    for (const text of sections.process) {
      lines.push(`- ${text}`);
    }
  }

  if (sections.commands.length > 0) {
    if (lines.length > 0) lines.push('');
    lines.push('## Commands');
    lines.push('');
    for (const text of sections.commands) {
      lines.push(`- ${text}`);
    }
  }

  // Trailing newline
  lines.push('');

  return lines.join('\n');
}

// --- LLM-based generation (--deep) ---

function formatDirectoryTree(entries: DirectoryEntry[], indent = ''): string {
  return entries
    .map((e) => {
      const line = `${indent}${e.path}/ (${e.fileCount} files)`;
      const children = e.children ? formatDirectoryTree(e.children, indent + '  ') : '';
      return children ? `${line}\n${children}` : line;
    })
    .join('\n');
}

export function buildDeepPrompt(stack: DetectedStack, cwd: string): string {
  const context = collectProjectContext(cwd);

  const parts: string[] = [];

  parts.push('Generate a CLAUDE.md file for this project. Follow these rules exactly:');
  parts.push('');
  parts.push('1. Use three sections in this order: ## Code, ## Process, ## Commands');
  parts.push('2. Keep it under 40 lines total');
  parts.push('3. Use imperative language: "Use X", "Never Y", "Always Z"');
  parts.push('4. Only include rules that prevent real mistakes');
  parts.push('5. Do NOT include a project name, description, or preamble');
  parts.push('6. Do NOT document things Claude can infer from reading the code');
  parts.push('7. Do NOT include formatting/style rules that belong in a linter');
  parts.push('8. Each rule is a list item starting with "- "');
  parts.push('');
  parts.push('Project metadata:');
  parts.push('');

  if (stack.packageManager) {
    parts.push(`Package manager: ${stack.packageManager}`);
  }
  if (stack.language) {
    parts.push(`Language: ${stack.language}`);
  }
  if (stack.framework) {
    parts.push(`Framework: ${stack.framework}`);
  }
  if (stack.testRunner) {
    parts.push(`Test runner: ${stack.testRunner}`);
  }
  if (stack.database) {
    parts.push(`Database: ${stack.database}`);
  }
  if (stack.styling) {
    parts.push(`Styling: ${stack.styling}`);
  }
  if (stack.linter) {
    parts.push(`Linter: ${stack.linter}`);
  }
  if (stack.monorepo) {
    parts.push(`Monorepo: ${stack.monorepo}`);
  }

  if (context.dependencies.length > 0) {
    parts.push('');
    parts.push(`Dependencies: ${context.dependencies.join(', ')}`);
  }

  if (context.tsconfig) {
    parts.push('');
    parts.push(`TypeScript config: ${JSON.stringify(context.tsconfig)}`);
  }

  if (context.directoryTree.length > 0) {
    parts.push('');
    parts.push('Directory structure:');
    parts.push(formatDirectoryTree(context.directoryTree));
  }

  if (Object.keys(stack.scripts).length > 0) {
    parts.push('');
    parts.push('package.json scripts:');
    for (const [name, cmd] of Object.entries(stack.scripts)) {
      parts.push(`  ${name}: ${cmd}`);
    }
  }

  parts.push('');
  parts.push('Return ONLY the markdown content. No explanations, no code fences.');

  return parts.join('\n');
}

export async function generateFromLLM(stack: DetectedStack, cwd: string): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic();
  const prompt = buildDeepPrompt(stack, cwd);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => 'text' in block ? block.text : '')
    .join('\n');

  // Strip code fences if the LLM wrapped the output
  const stripped = text.replace(/^```(?:markdown|md)?\n/m, '').replace(/\n```\s*$/m, '');

  // Ensure trailing newline
  return stripped.endsWith('\n') ? stripped : stripped + '\n';
}
