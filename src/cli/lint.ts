import path from 'node:path';
import type { Command } from 'commander';
import { loadConfig } from '../config/loader.js';
import { discoverInstructionFiles, discoverLintTargets } from '../parsers/auto-detect.js';
import { loadEffectiveInstructionGraph } from '../parsers/instruction-loader.js';
import { detectVague } from '../analyzers/vague-detector.js';
import { detectDuplicates } from '../analyzers/duplicate-detector.js';
import { detectConflicts } from '../analyzers/conflict-detector.js';
import { flagVersions } from '../analyzers/version-flagger.js';
import { analyzeOrdering } from '../analyzers/ordering-analyzer.js';
import { detectLinterRules } from '../analyzers/linter-rule-detector.js';
import { advisePlacement } from '../analyzers/placement-advisor.js';
import { validateInstructionMetadata } from '../analyzers/instruction-metadata-validator.js';
import { detectWeakEmphasis } from '../analyzers/emphasis-detector.js';
import { analyzeTokens } from '../analyzers/token-counter.js';
import { analyzeDeep } from '../analyzers/deep-analyzer.js';
import { TerminalReporter } from '../reporters/terminal.js';
import { JsonReporter } from '../reporters/json.js';
import { MarkdownReporter } from '../reporters/markdown.js';
import type { LintResult } from '../analyzers/types.js';
import type { Reporter } from '../reporters/types.js';
import { createDeepSpinner } from './spinner.js';

export function registerLintCommand(program: Command): void {
  program
    .command('lint [file]')
    .description('Lint instruction files for issues')
    .option('--format <format>', 'output format: terminal, json, or markdown', 'terminal')
    .option('--deep', 'run deep AI-powered analysis (requires ANTHROPIC_API_KEY)')
    .option('--ci', 'exit with non-zero code if any issues are found (for CI pipelines)')
    .action(async (file: string | undefined, options: { format: string; deep: boolean; ci: boolean }) => {
      const cwd = process.cwd();
      const config = loadConfig(cwd);
      const discovered = discoverInstructionFiles(cwd);
      const discoveredPaths = discovered.map((f) => f.relativePath);

      // Determine which files to analyze
      let filesToAnalyze: string[];

      if (file) {
        // Explicit file argument — resolve to absolute
        filesToAnalyze = [path.resolve(cwd, file)];
      } else {
        if (discovered.length === 0) {
          console.error('No instruction files found. Run `alignkit init` to create one.');
          process.exit(1);
        }
        // Analyze each effective target once
        filesToAnalyze = discoverLintTargets(cwd).map((f) => f.absolutePath);
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
        let rules = loadEffectiveInstructionGraph(filePath, cwd).rules;
        const fileDiagnostics = validateInstructionMetadata(filePath, rules);

        // Run all analyzers in sequence
        rules = detectVague(rules);
        rules = detectDuplicates(rules);
        rules = detectConflicts(rules);
        rules = flagVersions(rules);
        rules = analyzeOrdering(rules);
        rules = detectLinterRules(rules);
        rules = advisePlacement(rules, cwd);
        rules = detectWeakEmphasis(rules);

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
          fileDiagnostics,
          tokenAnalysis,
          discoveredFiles: discoveredPaths,
        };

        results.push(result);

        // Deep analysis if requested — use the instruction file's directory
        // as project context, not CWD (they may differ when linting a file
        // in another directory)
        if (options.deep) {
          const spinner = options.format === 'terminal' ? createDeepSpinner() : null;
          try {
            const projectDir = path.dirname(filePath);
            const deepResult = await analyzeDeep(rules, projectDir);
            if (deepResult !== undefined) {
              rules = deepResult.rules;
              result.rules = deepResult.rules;
              result.deepAnalysis = deepResult.result;
            }
            spinner?.succeed('Deep analysis complete');
          } catch (err) {
            spinner?.fail('Deep analysis failed');
            throw err;
          }
        }

        // Print formatted output for this file
        console.log(reporter.report(result));
      }

      // CI mode: exit with non-zero code if any issues found
      if (options.ci) {
        const totalDiags = results.reduce(
          (sum, r) => sum
            + r.fileDiagnostics.length
            + r.rules.reduce((s, rule) => s + rule.diagnostics.length, 0),
          0,
        );
        if (totalDiags > 0) {
          process.exitCode = 1;
        }
      }
    });
}
