# Galaxi

AI-powered personalized learning platform. Users state a learning goal and receive a personalized, adaptive curriculum built by multi-agent AI.

## Architecture

- **Framework:** Next.js 16 (App Router) with TypeScript
- **Database:** PostgreSQL + Prisma (9 tables)
- **Auth:** Supabase Auth (Google OAuth) via @supabase/ssr
- **AI:** Vercel AI SDK (ai + @ai-sdk/anthropic + @ai-sdk/google)
- **Agents:** Custom typed pipeline runner for orchestration
- **File Abstraction:** LEARNER.md, TOPIC.md, MEMORY.md rendered from DB state for agent context
- **Styling:** Tailwind CSS + shadcn/ui (scaffold)

## Key Conventions

- TypeScript strict mode
- Prisma for all data access (no raw SQL except arrays)
- Vercel AI SDK for all LLM calls (generateObject, streamText)
- File abstraction layer renders DB state as markdown for agent context
- Agent configs are data (AgentConfig type), not imperative code
- Pipelines are typed DAGs executed by a generic runner

## Directory Structure

```
src/
  app/             # Next.js App Router pages and API routes
    (app)/         # Authenticated routes (topics, learn, profile, onboard)
    (auth)/        # Auth routes (login, callback)
    api/           # API routes (topics, agents, profile)
  components/      # React components
    layout/        # Shell components (nav, user menu)
    learn/         # Learning UI (lesson reader, assessments)
    onboard/       # Onboarding flow
    profile/       # Profile editor
  lib/
    agents/        # Agent framework
      framework/   # Base agent, pipeline runner, orchestrator
      agents/      # Agent configs (researcher, curriculum, content, assessor)
      prompts/     # System prompts
      pipelines/   # Pipeline definitions (create-topic, generate-lesson)
    auth/          # Supabase auth clients
    db/            # Prisma client
    memory/        # File abstraction layer (renderers)
  types/           # TypeScript type definitions
prisma/            # Schema and migrations
```

## Commands

- `pnpm dev` — Start dev server
- `pnpm test` — Run tests
- `pnpm build` — Production build
- `npx prisma studio` — Open database GUI
- `npx prisma db seed` — Seed development data
- `npx prisma migrate dev` — Run migrations

## Current Phase

Phase 0 — Foundation + Core Learning Loop
