import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v3';
import { lintTool } from './tools/lint.js';
import { checkTool } from './tools/check.js';
import { statusTool } from './tools/status.js';

const server = new McpServer({
  name: 'alignkit',
  version: '0.1.4',
});

server.tool(
  'alignkit_lint',
  'Analyze an instruction file (CLAUDE.md, .claude/agents/*.md, .claude/skills/*/SKILL.md, .cursorrules, and related formats) for structural issues. Returns rules, diagnostics, project context, and token analysis. Use the project context to provide effectiveness predictions and coverage gap analysis.',
  {
    file: z.string().optional().describe('Path to instruction file (auto-discovers if not provided)'),
  },
  async (args) => {
    try {
      const cwd = process.cwd();
      const result = lintTool(cwd, args.file);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  },
);

server.tool(
  'alignkit_check',
  'Check which rules the coding agent actually follows by analyzing Claude Code session history. Returns per-rule adherence from auto-verification, plus unresolved rules with session action summaries for you to evaluate.',
  {
    file: z.string().optional().describe('Path to instruction file (auto-discovers if not provided)'),
    since_days: z.number().optional().describe('Analyze sessions from the last N days (defaults to since last file modification)'),
  },
  async (args) => {
    try {
      const cwd = process.cwd();
      const result = checkTool(cwd, args.file, args.since_days);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  },
);

server.tool(
  'alignkit_status',
  'Quick pulse check of instruction file adherence. Returns overall adherence percentage, session count, and trend.',
  {
    file: z.string().optional().describe('Path to instruction file (auto-discovers if not provided)'),
  },
  async (args) => {
    try {
      const cwd = process.cwd();
      const result = statusTool(cwd, args.file);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
        isError: true,
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
