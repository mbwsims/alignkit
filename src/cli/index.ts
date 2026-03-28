#!/usr/bin/env node
import { Command } from 'commander';
import { registerLintCommand } from './lint.js';
import { registerCheckCommand } from './check.js';

const program = new Command();

program
  .name('agentlint')
  .description('Measure, debug, and optimize AI coding agent instruction files')
  .version('0.1.0');

registerLintCommand(program);
registerCheckCommand(program);

program.parse();
