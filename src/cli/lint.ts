import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import { discoverInstructionFiles, parseInstructionFile } from '../parsers/auto-detect.js';
import { detectVague } from '../analyzers/vague-detector.js';
import { detectDuplicates } from '../analyzers/duplicate-detector.js';
import { detectConflicts } from '../analyzers/conflict-detector.js';
import { flagVersions } from '../analyzers/version-flagger.js';
import { analyzeOrdering } from '../analyzers/ordering-analyzer.js';
import { analyzeTokens } from '../analyzers/token-counter.js';
import { analyzeDeep } from '../analyzers/deep-analyzer.js';
import { TerminalReporter } from '../reporters/terminal.js';
import { JsonReporter } from '../reporters/json.js';
import { MarkdownReporter } from '../reporters/markdown.js';
import type { LintResult } from '../analyzers/types.js';
import type { Reporter } from '../reporters/types.js';

export function registerLintCommand(program: Command): void {
  program
    .command('lint [file]')
    .description('Lint instruction files for issues')
    .option('--format <format>', 'output format: terminal, json, or markdown', 'terminal')
    .option('--deep', 'run deep AI-powered analysis (requires ANTHROPIC_API_KEY)')
    .option('--all', 'analyze all discovered instruction files')
    .action(async (file: string | undefined, options: { format: string; deep: boolean; all: boolean }) => {
      const cwd = process.cwd();
      const config = loadConfig(cwd);
      const discovered = discoverInstructionFiles(cwd);
      const discoveredPaths = discovered.map((f) => f.relativePath);

      // Determine which files to analyze
      let filesToAnalyze: string[];

      if (file) {
        // Explicit file argument — resolve to absolute
        filesToAnalyze = [path.resolve(cwd, file)];
      } else if (options.all) {
        if (discovered.length === 0) {
          console.error('Error: No instruction files found.');
          process.exit(1);
        }
        filesToAnalyze = discovered.map((f) => f.absolutePath);
      } else {
        if (discovered.length === 0) {
          console.error('Error: No instruction files found.');
          process.exit(1);
        }
        // Analyze only the primary (first) file
        filesToAnalyze = [discovered[0].absolutePath];
      }

      // Select reporter
      let reporter: Reporter;
      switch (options.format) {
        case 'json':
          reporter = new JsonReporter();
          break;
        case 'markdown':
          reporter = new MarkdownReporter();
          break;
        default:
          reporter = new TerminalReporter();
          break;
      }

      const results: LintResult[] = [];

      for (const filePath of filesToAnalyze) {
        const content = readFileSync(filePath, 'utf-8');

        // Parse
        let rules = parseInstructionFile(content, filePath);

        // Run all analyzers in sequence
        rules = detectVague(rules);
        rules = detectDuplicates(rules);
        rules = detectConflicts(rules);
        rules = flagVersions(rules);
        rules = analyzeOrdering(rules);

        // Token analysis
        const tokenAnalysis = analyzeTokens(rules, {
          contextWindow: config.contextWindow,
          tokenBudget: config.thresholds?.tokenBudget,
        });

        // Relative path for display
        const relPath = path.relative(cwd, filePath);

        const result: LintResult = {
          file: relPath,
          rules,
          tokenAnalysis,
          discoveredFiles: discoveredPaths,
        };

        results.push(result);

        // Deep analysis if requested
        if (options.deep) {
          await analyzeDeep(rules, cwd);
        }

        // Print formatted output for this file
        console.log(reporter.report(result));
      }
    });
}
