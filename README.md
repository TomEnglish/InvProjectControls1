# Invenio ProjectControls

Multi-tenant construction project-controls platform. See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full build contract.

## Phase 0 status
Scaffold complete: frontend shell, Supabase schema (14 tables + RLS), core RPCs, shared Zod schemas, seed script. No module UIs built yet — all 8 routes render a stub.

## Prerequisites
- Node 20+
- Docker Desktop (running)
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started)

## Quickstart (local)
```bash
npm install
npm run db:start                          # boots local Supabase stack (Docker)
# Copy the keys it prints into .env:
cp .env.example .env
# Then edit .env — fill in VITE_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY from `supabase status`.
npm run seed:demo                         # seeds tenant, users, projects, COA, ROC, records
npm run dev                               # Vite dev server on :5173
```

Seeded user: the ProgressTracker UAT admin (`uat-bot@invenio.com`) is bound as ProjectControls admin. Obtain the password from your Supabase Auth dashboard, not from this repo.

To run the smoke test locally, add `SMOKE_EMAIL` and `SMOKE_PASSWORD` to `.env` (gitignored).

## Repo layout
```
frontend/          Vite + React 19 + TS + Tailwind v4 app
packages/schemas/  Shared Zod schemas (frontend + edge fns)
supabase/          Migrations + config + (future) edge functions
scripts/seed/      TypeScript seed script
reference/         The original HTML demo (not deployed)
```

## Scripts
- `npm run dev` — frontend dev server
- `npm run db:start` / `db:stop` / `db:reset` — local Supabase
- `npm run db:diff` — generate migration from live DB delta
- `npm run seed:{minimal,demo,stress}` — seed data
- `npm run typecheck` — project-wide TS check
- `npm run lint`, `npm run build` — inside `frontend/`

## Next (Phase 1)
Auth + Dashboard vertical slice — wire the `project_summary` RPC into real KPI cards and the S-curve. See ARCHITECTURE.md §XV Dashboard.
