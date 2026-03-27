#!/usr/bin/env node
import { Command } from 'commander';
import { registerLintCommand } from './lint.js';

const program = new Command();

program
  .name('agentlint')
  .description('Measure, debug, and optimize AI coding agent instruction files')
  .version('0.1.0');

registerLintCommand(program);

program.parse();
