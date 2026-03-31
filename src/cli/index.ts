#!/usr/bin/env node
import { Command } from 'commander';
import { registerLintCommand } from './lint.js';
import { registerCheckCommand } from './check.js';
import { registerWatchCommand } from './watch.js';
import { registerStatusCommand } from './status.js';
import { registerReportCommand } from './report.js';
import { registerOptimizeCommand } from './optimize.js';
import { registerInitCommand } from './init.js';

const program = new Command();

program
  .name('alignkit')
  .description('Instruction intelligence for coding agents')
  .version('0.1.3');

registerLintCommand(program);
registerCheckCommand(program);
registerWatchCommand(program);
registerStatusCommand(program);
registerReportCommand(program);
registerOptimizeCommand(program);
registerInitCommand(program);

// Default to lint when no subcommand is given
// e.g., `npx alignkit` runs lint, `npx alignkit --deep` runs lint --deep
if (process.argv.length <= 2 || (process.argv.length > 2 && !process.argv.slice(2).some(arg =>
  ['lint', 'check', 'watch', 'status', 'report', 'optimize', 'init', 'help', '--help', '-h', '--version', '-V'].includes(arg)
))) {
  // Insert 'lint' as the subcommand
  process.argv.splice(2, 0, 'lint');
}

program.parseAsync();
