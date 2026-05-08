# 🐺 BloodHound 

**Autonomous smart contract security auditing engine.**

Paste a GitHub repo URL, choose your AI model and report format, and get a Code4rena or Immunefi formatted vulnerability report — complete with Proof of Concept exploits — powered by Claude AI.

---

## BloodHound Features

- **Autonomous audit pipeline** — fetches up to 50 Solidity files, runs 8 static heuristic checks, then sends everything to Claude for deep analysis
- **Three Claude models** — Haiku 4.5 (fast/cheap), Sonnet 4 (balanced default), Opus 4 (deepest analysis)
- **Two report formats** — Code4rena competitive audit format or Immunefi bug bounty format
- **Real-time progress** — live streaming updates as each audit phase completes (SSE)
- **Proof of Concept** — every finding includes a PoC (Foundry-style for critical/high, step-by-step for lower severity)
- **Download reports** — export complete `.md` audit reports at any time
- **Severity tiers** — findings categorized as critical, high, medium, low, informational, or gas
- **Donation-based access** — 1 free hunt per day; unlock more by donating ETH (verified on-chain)

---

## Access Tiers

| Tier | Donation | Hunts | Duration |
|------|----------|-------|----------|
| Free | — | 1/day | Always |
| Hunter | 0.01 ETH | 30 | 30 days |
| Specialist | 0.1 ETH | 30 | 360 days |
| Lifetime Sponsor | 1+ ETH | Unlimited | Forever |

Donation address: `0x2091125bFE4259b2CfA889165Beb6290d0Df5DeA`

Verified on-chain — paste your Ethereum transaction hash after sending. No accounts, no email, no tracking.

Lifetime sponsors (1+ ETH) are listed publicly on the dashboard.

---

## Stack

- **Runtime**: Node.js 24, TypeScript 5.9, pnpm workspaces
- **API**: Express 5 (esbuild CJS bundle)
- **Frontend**: React + Vite + Tailwind + shadcn/ui + wouter
- **Database**: PostgreSQL + Drizzle ORM
- **AI**: Anthropic Claude via OpenRouter (`openai` SDK, model `anthropic/claude-sonnet-4`)
- **Validation**: Zod (v4), drizzle-zod
- **API contract**: OpenAPI 3.1 → Orval (React Query hooks + Zod schemas)

---

## Running Locally

### Prerequisites

- Node.js 24+
- pnpm 9+
- PostgreSQL database

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Session signing key |
| `OPENROUTER_API_KEY` | Yes | OpenRouter key for Claude access |
| `GITHUB_TOKEN` | Recommended | GitHub PAT (raises rate limit to 5,000 req/hr) |

### Setup

```bash
# Install dependencies
pnpm install

# Push DB schema
pnpm --filter @workspace/db run push

# Start API server (port from $PORT env, proxied at /api)
pnpm --filter @workspace/api-server run dev

# Start frontend (proxied at /)
pnpm --filter @workspace/bloodhound-ui run dev
```

### Codegen (after OpenAPI spec changes)

```bash
pnpm --filter @workspace/api-spec run codegen
```

---

## Architecture

### Audit Pipeline

```
GitHub API → Solidity parser → 8 heuristic checks → Claude AI → findings + markdown report → DB
```

1. **GitHub fetcher** (`lib/github.ts`) — authenticates with `GITHUB_TOKEN`, lists Solidity files, enforces a 300-file repo size guard, fetches up to 50 files
2. **Heuristics** (`lib/heuristics.ts`) — 8 static regex/AST checks (reentrancy, unchecked calls, access control, overflow, etc.)
3. **AI analyzer** (`lib/ai-analyzer.ts`) — sends contracts + heuristic hits to Claude via OpenRouter; 4-strategy JSON extraction fallback for reliability
4. **Hunt engine** (`lib/hunt-engine.ts`) — orchestrates the pipeline, emits SSE progress events at each phase

### Real-time Progress (SSE)

Hunts emit progress events over Server-Sent Events at `GET /api/hunts/:id/progress`. The frontend uses native `EventSource`. An in-memory `Map<huntId, listener[]>` fans out events — not clustered, resets on server restart.

On server restart, any hunt still marked `running` is automatically marked `failed` (startup recovery).

### Contract-First API

OpenAPI spec in `lib/api-spec/openapi.yaml` is the single source of truth. Orval generates:
- React Query hooks + TypeScript types → `lib/api-client-react/src/generated/`
- Zod validation schemas for Express → `lib/api-zod/src/generated/`

Always run codegen after editing the spec.

### ETH Donation Verification

Donations are verified on-chain via the public Ethereum JSON-RPC (`eth.llamarpc.com` — no API key needed):

1. User sends ETH to `0x2091125bFE4259b2CfA889165Beb6290d0Df5DeA`
2. User pastes tx hash into Bloodhound
3. Server calls `eth_getTransactionByHash` to verify recipient address and amount
4. Tier is assigned based on amount; quota stored in DB against the requester's IP
5. Tx hash is stored to prevent reuse

---

## Project Structure

```
├── artifacts/
│   ├── api-server/          # Express API (esbuild CJS)
│   │   └── src/
│   │       ├── routes/      # hunts + donations routes
│   │       └── lib/         # hunt-engine, ai-analyzer, github, heuristics
│   └── bloodhound-ui/       # React + Vite frontend
│       └── src/
│           ├── pages/       # home (dashboard), hunt-results
│           └── components/  # donation-modal, shadcn/ui components
├── lib/
│   ├── api-spec/            # openapi.yaml (source of truth)
│   ├── api-zod/             # generated Zod schemas (do not edit)
│   ├── api-client-react/    # generated React Query hooks (do not edit)
│   └── db/                  # Drizzle schema + client
└── scripts/                 # utility scripts
```

---

## Rate Limits

- **Global**: 120 req/min per IP
- **Hunt creation**: enforced by the donation tier system (1/day free; 30/period for paid tiers)
- **GitHub API**: 5,000 req/hr with `GITHUB_TOKEN`; 60 req/hr without

---

## License

MIT
