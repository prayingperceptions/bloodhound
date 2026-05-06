# Bloodhound

Autonomous smart contract security auditing engine — paste a GitHub repo URL, run a hunt, and get Code4rena or Immunefi formatted vulnerability reports powered by Claude AI.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at `/api`)
- `pnpm --filter @workspace/bloodhound-ui run dev` — run the React frontend (proxied at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET` — session signing

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (esbuild CJS bundle)
- Frontend: React + Vite + Tailwind + shadcn/ui + wouter routing
- DB: PostgreSQL + Drizzle ORM
- AI: Anthropic Claude (via `@workspace/integrations-anthropic-ai` Replit proxy — no user key needed)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (OpenAPI → React Query hooks + Zod schemas)

## Where things live

- `lib/db/src/schema/hunts.ts` — DB schema + `Finding` interface
- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth for contracts)
- `lib/api-zod/src/generated/api.ts` — Zod schemas for Express routes
- `lib/api-client-react/src/generated/` — React Query hooks + TypeScript types for frontend
- `artifacts/api-server/src/routes/hunts/index.ts` — hunt CRUD + SSE progress routes
- `artifacts/api-server/src/lib/hunt-engine.ts` — full audit pipeline orchestrator
- `artifacts/api-server/src/lib/ai-analyzer.ts` — Anthropic integration + report generation
- `artifacts/api-server/src/lib/heuristics.ts` — 8 static analysis checks
- `artifacts/api-server/src/lib/github.ts` — GitHub API Solidity file fetcher
- `artifacts/bloodhound-ui/src/pages/home.tsx` — Dashboard + new hunt form
- `artifacts/bloodhound-ui/src/pages/hunt-results.tsx` — Live SSE progress + findings display

## Architecture decisions

- **Contract-first API**: OpenAPI spec in `lib/api-spec/` drives both server validation (Zod) and client hooks (React Query) via Orval codegen. Run codegen after any spec change.
- **SSE for progress**: Hunt pipeline emits real-time progress events over Server-Sent Events at `GET /api/hunts/:id/progress`. Frontend uses native `EventSource`. In-memory `Map<huntId, listeners[]>` — not clustered.
- **AI via Replit proxy**: Anthropic is accessed through `@workspace/integrations-anthropic-ai` — no user API key required; billing flows through Replit.
- **Hunt pipeline**: GitHub API (up to 40 Solidity files) → regex parser → 8 heuristic checks → Claude AI deep analysis → save findings + markdown report to DB.
- **Two report modes**: `code4rena` (structured competitive audit format) and `immunefi` (bug bounty format). Mode selected at hunt creation time.

## Product

- Paste any public GitHub repo URL to start an autonomous security hunt
- Real-time streaming progress (file fetching → parsing → heuristics → AI analysis)
- Findings organized by severity: critical, high, medium, low, informational, gas
- Download complete audit reports as `.md` in Code4rena or Immunefi format
- Dashboard with aggregate stats (total hunts, findings, critical/high counts)
- Hunt history with status tracking

## User preferences

_Populate as you build._

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after editing the OpenAPI spec before touching route or frontend code.
- Never use `console.log` in server code — use `req.log` in route handlers and `logger` from `./lib/logger` elsewhere.
- The SSE progress endpoint uses an in-memory listener map — restarting the server loses in-flight hunt listeners (hunts themselves persist in DB).
- `huntsTable` primary key is `text("id")` (UUID string), not a serial integer.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
- Anthropic AI: `.local/skills/ai-integrations-anthropic/`
