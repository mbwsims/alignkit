import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseJsonc } from 'jsonc-parser';

export interface AlignkitConfig {
  instructionFile?: string;
  sessionsDir?: string;
  rules?: Record<string, { verifier?: string; check?: string }>;
  thresholds?: {
    tokenBudget?: number;
    flagBelow?: number;
    warnBelow?: number;
  };
  contextWindow?: number;
}

export function loadConfig(cwd: string): AlignkitConfig {
  // Try .alignkit.config.jsonc
  const configPath = join(cwd, '.alignkit.config.jsonc');
  if (existsSync(configPath)) {
    const content = readFileSync(configPath, 'utf-8');
    return parseJsonc(content) ?? {};
  }

  // Try package.json "alignkit" key
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.alignkit) return pkg.alignkit;
    } catch {
      // ignore parse errors
    }
  }

  return {};
}
