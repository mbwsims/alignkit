#!/usr/bin/env node
import { Command } from 'commander';
import { registerLintCommand } from './lint.js';
import { registerCheckCommand } from './check.js';
import { registerWatchCommand } from './watch.js';
import { registerStatusCommand } from './status.js';
import { registerReportCommand } from './report.js';
import { registerOptimizeCommand } from './optimize.js';

const program = new Command();

program
  .name('alignkit')
  .description('Instruction intelligence for coding agents')
  .version('0.1.0');

registerLintCommand(program);
registerCheckCommand(program);
registerWatchCommand(program);
registerStatusCommand(program);
registerReportCommand(program);
registerOptimizeCommand(program);

program.parse();
