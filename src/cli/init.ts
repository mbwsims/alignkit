import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pc from 'picocolors';
import type { Command } from 'commander';
import { detectStack } from '../generators/stack-detector.js';
import { generateFromTemplates, generateFromLLM } from '../generators/init-generator.js';
import { createDeepSpinner } from './spinner.js';

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Generate a starter CLAUDE.md for your project')
    .option('--deep', 'use LLM to generate a more tailored file (~$0.02, requires ANTHROPIC_API_KEY)')
    .option('--dry-run', 'print to stdout instead of writing a file')
    .action(async (options: { deep?: boolean; dryRun?: boolean }) => {
      const cwd = process.cwd();
      const stack = detectStack(cwd);

      // Generate content
      let content: string;

      if (options.deep) {
        if (!process.env.ANTHROPIC_API_KEY) {
          console.error('Error: --deep requires ANTHROPIC_API_KEY.\n');
          console.error('  export ANTHROPIC_API_KEY=sk-ant-...\n');
          console.error('Get a key at https://console.anthropic.com/settings/keys');
          process.exit(1);
        } else {
          const spinner = createDeepSpinner();
          try {
            content = await generateFromLLM(stack, cwd);
            spinner.succeed('Generated with deep analysis');
          } catch (err) {
            spinner.fail('Deep analysis failed');
            const message = err instanceof Error ? err.message : String(err);
            console.error(pc.yellow(`Falling back to template mode (${message}).`));
            content = generateFromTemplates(stack);
          }
        }
      } else {
        content = generateFromTemplates(stack);
      }

      // Dry run: print and exit
      if (options.dryRun) {
        process.stdout.write(content);
        return;
      }

      // Determine output path
      const claudeMdPath = join(cwd, 'CLAUDE.md');
      let outputPath: string;

      if (existsSync(claudeMdPath)) {
        outputPath = join(cwd, 'CLAUDE.init.md');
        writeFileSync(outputPath, content, 'utf-8');
        console.log(`CLAUDE.md already exists. Generated ${pc.bold('CLAUDE.init.md')} — review and merge manually.`);
      } else {
        outputPath = claudeMdPath;
        writeFileSync(outputPath, content, 'utf-8');
        console.log(`Generated ${pc.bold('CLAUDE.md')}`);
      }

      // Print summary
      const lineCount = content.split('\n').filter((l) => l.trim()).length;
      const detected: string[] = [];
      if (stack.packageManager) detected.push(stack.packageManager);
      if (stack.language) detected.push(stack.language);
      if (stack.framework) detected.push(stack.framework);
      if (stack.testRunner) detected.push(stack.testRunner);
      if (stack.database) detected.push(stack.database);

      if (detected.length > 0) {
        console.log(pc.dim(`  Detected: ${detected.join(', ')}`));
      }
      console.log(pc.dim(`  ${lineCount} lines. Run ${pc.cyan('alignkit lint')} to check it.`));
    });
}
