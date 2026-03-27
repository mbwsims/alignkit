import type { Rule } from '../parsers/types.js';

export async function analyzeDeep(rules: Rule[], cwd: string): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is required for --deep analysis.');
    console.error('Set it with: export ANTHROPIC_API_KEY=your-key');
    process.exit(1);
  }
  console.log('\n--deep analysis is not yet implemented. Coming soon.');
}
