import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface DetectedStack {
  packageManager: 'pnpm' | 'yarn' | 'npm' | null;
  framework: string | null;
  language: 'typescript' | 'javascript' | 'python' | null;
  testRunner: string | null;
  database: string | null;
  styling: string | null;
  linter: string | null;
  monorepo: string | null;
  scripts: Record<string, string>;
}

const FRAMEWORK_MAP: Record<string, string> = {
  'next': 'nextjs',
  'react': 'react',
  'express': 'express',
  'fastify': 'fastify',
  '@nestjs/core': 'nestjs',
  'hono': 'hono',
  'vue': 'vue',
  'nuxt': 'nuxt',
  'svelte': 'svelte',
  '@sveltejs/kit': 'sveltekit',
  'astro': 'astro',
  'remix': 'remix',
  '@remix-run/node': 'remix',
};

const TEST_RUNNER_MAP: Record<string, string> = {
  'vitest': 'vitest',
  'jest': 'jest',
  'mocha': 'mocha',
  '@playwright/test': 'playwright',
  'cypress': 'cypress',
};

const DATABASE_MAP: Record<string, string> = {
  'prisma': 'prisma',
  '@prisma/client': 'prisma',
  'drizzle-orm': 'drizzle',
  'mongoose': 'mongoose',
  'typeorm': 'typeorm',
  'sequelize': 'sequelize',
  'kysely': 'kysely',
};

const STYLING_MAP: Record<string, string> = {
  'tailwindcss': 'tailwind',
  '@tailwindcss/postcss': 'tailwind',
  'styled-components': 'styled-components',
  '@emotion/react': 'emotion',
};

const LINTER_MAP: Record<string, string> = {
  'eslint': 'eslint',
  '@biomejs/biome': 'biome',
  'prettier': 'prettier',
  'oxlint': 'oxlint',
};

function firstMatch(deps: string[], map: Record<string, string>): string | null {
  for (const dep of deps) {
    if (map[dep]) return map[dep];
  }
  return null;
}

function detectPackageManager(cwd: string): 'pnpm' | 'yarn' | 'npm' | null {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(cwd, 'package-lock.json'))) return 'npm';
  if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) return 'npm'; // treat bun as npm-compatible
  return null;
}

function detectLanguage(cwd: string): 'typescript' | 'javascript' | 'python' | null {
  if (existsSync(join(cwd, 'tsconfig.json'))) return 'typescript';
  if (existsSync(join(cwd, 'pyproject.toml')) || existsSync(join(cwd, 'requirements.txt')) || existsSync(join(cwd, 'setup.py'))) return 'python';
  if (existsSync(join(cwd, 'package.json'))) return 'javascript';
  return null;
}

function detectMonorepo(cwd: string): string | null {
  if (existsSync(join(cwd, 'turbo.json'))) return 'turborepo';
  if (existsSync(join(cwd, 'nx.json'))) return 'nx';
  try {
    const raw = readFileSync(join(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    if (pkg['workspaces']) return 'workspaces';
  } catch {
    // no package.json
  }
  if (existsSync(join(cwd, 'pnpm-workspace.yaml'))) return 'workspaces';
  return null;
}

function readScripts(cwd: string): Record<string, string> {
  try {
    const raw = readFileSync(join(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const scripts = pkg['scripts'] as Record<string, string> | undefined;
    return scripts ?? {};
  } catch {
    return {};
  }
}

function readDependencies(cwd: string): string[] {
  try {
    const raw = readFileSync(join(cwd, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const deps = pkg['dependencies'] as Record<string, string> | undefined;
    const devDeps = pkg['devDependencies'] as Record<string, string> | undefined;
    return [...Object.keys(deps ?? {}), ...Object.keys(devDeps ?? {})];
  } catch {
    return [];
  }
}

export function detectStack(cwd: string): DetectedStack {
  const deps = readDependencies(cwd);
  const scripts = readScripts(cwd);

  return {
    packageManager: detectPackageManager(cwd),
    framework: firstMatch(deps, FRAMEWORK_MAP),
    language: detectLanguage(cwd),
    testRunner: firstMatch(deps, TEST_RUNNER_MAP),
    database: firstMatch(deps, DATABASE_MAP),
    styling: firstMatch(deps, STYLING_MAP),
    linter: firstMatch(deps, LINTER_MAP),
    monorepo: detectMonorepo(cwd),
    scripts,
  };
}
