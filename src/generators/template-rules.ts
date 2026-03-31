import type { DetectedStack } from './stack-detector.js';

export interface TemplateRule {
  section: 'commands' | 'code' | 'process';
  text: string;
}

// --- Command generation from package.json scripts ---

const SCRIPT_DESCRIPTIONS: Record<string, string> = {
  dev: 'start dev server',
  start: 'start server',
  build: 'production build',
  test: 'run tests',
  'test:watch': 'run tests in watch mode',
  'test:e2e': 'run end-to-end tests',
  lint: 'run linter',
  typecheck: 'type check',
  format: 'format code',
  db: 'database operations',
  'db:push': 'push database schema',
  'db:migrate': 'run database migrations',
  'db:seed': 'seed database',
  'db:studio': 'open database studio',
  generate: 'generate code/types',
  deploy: 'deploy',
  clean: 'clean build artifacts',
  storybook: 'start storybook',
};

const SKIP_SCRIPTS = new Set([
  'prebuild', 'postbuild', 'preinstall', 'postinstall',
  'prepare', 'prepublishOnly', 'pretest', 'posttest',
  'predev', 'postdev',
]);

export function generateCommands(stack: DetectedStack): TemplateRule[] {
  const prefix = stack.packageManager ?? 'npm';
  const run = prefix === 'npm' ? 'npm run' : prefix;
  const rules: TemplateRule[] = [];

  for (const [name, _value] of Object.entries(stack.scripts)) {
    if (SKIP_SCRIPTS.has(name)) continue;

    const description = SCRIPT_DESCRIPTIONS[name];
    if (!description) continue;

    // For test scripts, append test runner name if detected
    let desc = description;
    if (name === 'test' && stack.testRunner) {
      desc = `run tests with ${stack.testRunner}`;
    }

    rules.push({
      section: 'commands',
      text: `\`${run} ${name}\` — ${desc}`,
    });
  }

  return rules;
}

// --- Stack-specific code rules ---

const STACK_RULES: Record<string, TemplateRule[]> = {
  typescript: [
    { section: 'code', text: 'TypeScript strict mode. No `any`.' },
  ],
  nextjs: [
    { section: 'code', text: 'Use server components by default. Client components only when needed.' },
    { section: 'code', text: 'Use Next.js App Router conventions for routing and layouts.' },
  ],
  react: [
    { section: 'code', text: 'Functional components only. No class components.' },
  ],
  express: [
    { section: 'code', text: 'Use async route handlers with proper error handling middleware.' },
  ],
  fastify: [
    { section: 'code', text: 'Use Fastify schema validation for all routes.' },
  ],
  nestjs: [
    { section: 'code', text: 'Follow NestJS module structure. Use dependency injection.' },
  ],
  prisma: [
    { section: 'code', text: 'Use Prisma for all data access — no raw SQL.' },
  ],
  drizzle: [
    { section: 'code', text: 'Use Drizzle ORM for all data access.' },
  ],
  mongoose: [
    { section: 'code', text: 'Use Mongoose models for all MongoDB operations.' },
  ],
  tailwind: [
    { section: 'code', text: 'Use Tailwind utility classes for styling. Avoid custom CSS unless necessary.' },
  ],
  vue: [
    { section: 'code', text: 'Use Composition API with `<script setup>`. No Options API.' },
  ],
  svelte: [
    { section: 'code', text: 'Use Svelte runes for reactivity.' },
  ],
  sveltekit: [
    { section: 'code', text: 'Use SvelteKit load functions for data fetching. Use form actions for mutations.' },
  ],
  astro: [
    { section: 'code', text: 'Use Astro components by default. Use framework components only for interactivity.' },
  ],
  remix: [
    { section: 'code', text: 'Use Remix loaders for data fetching and actions for mutations.' },
  ],
};

// --- Universal process rules ---

const UNIVERSAL_PROCESS: TemplateRule[] = [
  { section: 'process', text: 'Run tests before committing.' },
  { section: 'process', text: 'Never commit .env files or secrets.' },
];

const MONOREPO_RULES: Record<string, TemplateRule[]> = {
  turborepo: [
    { section: 'process', text: 'Use `turbo` to run tasks. It handles caching and dependency ordering.' },
  ],
  nx: [
    { section: 'process', text: 'Use `nx` to run tasks. Use `nx affected` to only run what changed.' },
  ],
};

// --- Assembly ---

export function collectTemplateRules(stack: DetectedStack): TemplateRule[] {
  const rules: TemplateRule[] = [];

  // Commands from scripts
  rules.push(...generateCommands(stack));

  // Language rules
  if (stack.language === 'typescript' && STACK_RULES['typescript']) {
    rules.push(...STACK_RULES['typescript']);
  }

  // Framework rules
  if (stack.framework && STACK_RULES[stack.framework]) {
    rules.push(...STACK_RULES[stack.framework]);
  }

  // Database rules
  if (stack.database && STACK_RULES[stack.database]) {
    rules.push(...STACK_RULES[stack.database]);
  }

  // Styling rules
  if (stack.styling && STACK_RULES[stack.styling]) {
    rules.push(...STACK_RULES[stack.styling]);
  }

  // Universal process rules
  rules.push(...UNIVERSAL_PROCESS);

  // Monorepo rules
  if (stack.monorepo && MONOREPO_RULES[stack.monorepo]) {
    rules.push(...MONOREPO_RULES[stack.monorepo]);
  }

  return rules;
}
