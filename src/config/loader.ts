import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';

export interface AgentlintConfig {
  instructionFile?: string;
  rules?: Record<string, { verifier?: string; check?: string }>;
  thresholds?: {
    tokenBudget?: number;
    flagBelow?: number;
    warnBelow?: number;
  };
  contextWindow?: number;
}

export function loadConfig(cwd: string): AgentlintConfig {
  // Try .agentlint.config.jsonc
  const configPath = join(cwd, '.agentlint.config.jsonc');
  if (existsSync(configPath)) {
    const content = readFileSync(configPath, 'utf-8');
    return parseJsonc(content) ?? {};
  }

  // Try package.json "agentlint" key
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.agentlint) return pkg.agentlint;
    } catch {
      // ignore parse errors
    }
  }

  return {};
}
