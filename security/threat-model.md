# Bloodhound — Threat Model

**Version:** 1.0  
**Date:** 2026-05-08  
**Scope:** Bloodhound web application (API server + React frontend + PostgreSQL)

---

## 1. System Overview

Bloodhound is a web-based smart contract security auditing engine. Users submit a GitHub repository URL; the server fetches Solidity source files, runs static heuristics, sends contracts to Claude AI via OpenRouter, and returns a formatted vulnerability report.

### Components

| Component | Technology | Trust Zone |
|-----------|-----------|------------|
| Frontend | React + Vite (Replit proxy) | Untrusted (browser) |
| API Server | Express 5 + Node.js 24 | Semi-trusted (Replit-isolated) |
| Database | PostgreSQL (Replit-managed) | Trusted |
| GitHub API | External (api.github.com) | Trusted upstream |
| OpenRouter / Claude | External AI provider | Trusted upstream |
| Ethereum RPC | eth.llamarpc.com (public) | Trusted for verification |

### Data Flows

```
User Browser
  │ HTTPS (POST /api/hunts)
  ▼
Replit Reverse Proxy (mTLS)
  │ HTTP (internal)
  ▼
Express API Server
  ├─► GitHub API → Solidity source files
  ├─► OpenRouter → Claude AI → findings JSON
  ├─► Ethereum RPC → tx verification
  └─► PostgreSQL → persist hunts + donors
```

---

## 2. Assets & Impact

| Asset | Confidentiality | Integrity | Availability |
|-------|----------------|-----------|--------------|
| OPENROUTER_API_KEY | CRITICAL — billed to owner | HIGH | HIGH |
| GITHUB_TOKEN | HIGH — 5000 req/hr quota | MEDIUM | MEDIUM |
| SESSION_SECRET | HIGH — session signing | CRITICAL | LOW |
| DATABASE_URL | CRITICAL — full DB access | CRITICAL | HIGH |
| Donor IP→tier mappings | MEDIUM | CRITICAL — fraud | MEDIUM |
| Hunt reports | LOW (public repos) | MEDIUM | MEDIUM |
| ETH donation address | LOW | CRITICAL — payment fraud | LOW |

---

## 3. Threat Actors

| Actor | Capability | Motivation |
|-------|-----------|------------|
| Free-tier abuser | Script kiddie | Unlimited free hunts |
| Donation fraudster | Moderate | Steal paid access |
| Competitive scraper | Moderate | Mass API consumption |
| Prompt injector | Moderate | Corrupt audit reports |
| Supply-chain attacker | High | Compromise npm dependencies |
| Malicious repo owner | Low-Moderate | Manipulate audit results |

---

## 4. STRIDE Threat Analysis

### 4.1 Spoofing

| ID | Threat | Component | Mitigation |
|----|--------|-----------|------------|
| S1 | IP spoofing via X-Forwarded-For | API rate limiting | `trust proxy: 1` correctly trusts only Replit's proxy layer; direct port access is blocked by Replit's networking |
| S2 | Donation tx replay across IPs | `/api/donations/verify` | `txHash` stored with UNIQUE constraint; second use returns 400 |
| S3 | Ethereum address spoofing in tx | Donation verify | `to` field verified against hardcoded donation address; `from` field stored for sponsor display only |

### 4.2 Tampering

| ID | Threat | Component | Mitigation |
|----|--------|-----------|------------|
| T1 | SQL injection in repoUrl / txHash | DB queries | Drizzle ORM with parameterized queries throughout — no raw SQL with user input |
| T2 | GitHub URL path traversal | `parseGithubUrl` | `owner` and `repo` validated against `[a-zA-Z0-9._-]+` regex; hostname restricted to `github.com` |
| T3 | Prompt injection via contract code | AI analyzer | System prompt explicitly instructs Claude to not hallucinate; contract content is structural (AST-like summary) not raw text in latest version |
| T4 | Hunt quota tampering via concurrent requests | POST /hunts | Atomic SQL `UPDATE ... WHERE hunts_used < hunt_limit RETURNING *` prevents TOCTOU race |
| T5 | ETH tx re-org fraud | Donation verify | Minimum 12 block confirmations (~3 min) required before acceptance |

### 4.3 Repudiation

| ID | Threat | Component | Mitigation |
|----|--------|-----------|------------|
| R1 | User denies running a hunt | Hunts table | IP address stored with each hunt; created_at timestamp immutable |
| R2 | Fraudulent donation claim | Donors table | On-chain tx hash stored; verifiable on Etherscan |

### 4.4 Information Disclosure

| ID | Threat | Component | Mitigation |
|----|--------|-----------|------------|
| I1 | Secret leak via error messages | Express error handler | Pino logger captures errors server-side; only safe error messages returned to client |
| I2 | GITHUB_TOKEN in server logs | fetchGithubApi | Token is in Authorization header, not URL; Pino serializer strips headers from logs |
| I3 | Donor IP exposed in API | Sponsors endpoint | Only ETH `from` address returned (public on-chain anyway), never IP |
| I4 | DATABASE_URL accessible to frontend | Architecture | Frontend is a static bundle with no server-side secrets; DATABASE_URL only present in API server environment |

### 4.5 Denial of Service

| ID | Threat | Component | Mitigation |
|----|--------|-----------|------------|
| D1 | Rate limit exhaustion | Global limiter | 120 req/min per IP via express-rate-limit with trust proxy |
| D2 | Hunt flooding exhausting OpenRouter credits | Hunt creation | Per-IP quota enforced in DB before creating hunt |
| D3 | Giant repo hanging the server | GitHub fetcher | 300-file repo size guard; 50-file fetch cap; 500KB per-file size cap |
| D4 | Runaway AI call hanging indefinitely | Hunt engine | 10-minute hard timeout via `Promise.race` with a rejection timer |
| D5 | DB connection exhaustion | pg Pool | Connection pooled via `pg.Pool`; Drizzle reuses connections |

### 4.6 Elevation of Privilege

| ID | Threat | Component | Mitigation |
|----|--------|-----------|------------|
| E1 | Free user bypassing quota to get donor hunts | POST /hunts | Donor check via DB lookup; atomic increment prevents race |
| E2 | Attacker claiming other user's donated quota | Donation system | Quota is IP-bound; attacker would need same IP as victim |
| E3 | Expired donor continuing to run hunts | getActiveDonor | Query filters `expires_at > now()` — expired donors fall back to free tier |

---

## 5. Trust Boundary Analysis

### Boundary 1: Internet → Replit Proxy
- **Controls**: Replit's mTLS proxy; DDoS protection at platform level
- **Residual risk**: Volumetric DDoS at Replit scale; mitigated by Replit infrastructure

### Boundary 2: Replit Proxy → API Server
- **Controls**: `trust proxy: 1`; rate limiting on `req.ip`
- **Residual risk**: IP spoofing impossible from outside (proxy controls X-Forwarded-For); shared NAT/VPN users share one quota bucket

### Boundary 3: API Server → External Services (GitHub, OpenRouter, Ethereum RPC)
- **Controls**: All calls go to hardcoded domains; no user-controlled URLs are fetched directly
- **Residual risk**: Third-party outage; supply-chain compromise of external services

### Boundary 4: User Input → Database
- **Controls**: Zod input validation; Drizzle ORM parameterized queries
- **Residual risk**: Very low — no raw SQL with user data

### Boundary 5: User Input → AI Prompt
- **Controls**: Repo content is parsed into a structural summary (contract names, function signatures, state variables) — not raw source code
- **Residual risk**: Carefully crafted function names/comments could influence AI; no direct code execution risk

---

## 6. Residual Risks & Accepted Risks

| Risk | Likelihood | Impact | Decision |
|------|-----------|--------|----------|
| Shared IP quota collision | Medium | Low | Accept — no good alternative without auth |
| Prompt injection via contract comments | Low | Medium | Accept — AI output is informational, not executed |
| Public Ethereum RPC availability | Low | Low | Accept — RPC timeout handled gracefully |
| OpenRouter API key theft | Very Low | High | Mitigate — key in env var, never logged |
| Re-org fraud < 12 blocks | Very Low | Low | Mitigate — 12 confirmation requirement |

---

## 7. Security Controls Summary

| Control | Status |
|---------|--------|
| HTTPS everywhere | ✅ Enforced by Replit proxy |
| Security headers (Helmet) | ✅ Implemented |
| CORS restriction | ✅ Restricted to REPLIT_DOMAINS |
| Rate limiting (global) | ✅ 120 req/min per IP |
| Input validation (Zod) | ✅ All endpoints |
| Parameterized SQL | ✅ Drizzle ORM |
| GitHub hostname validation | ✅ Regex + URL.hostname check |
| owner/repo sanitization | ✅ `[a-zA-Z0-9._-]+` regex |
| Atomic quota enforcement | ✅ SQL WHERE + RETURNING |
| ETH confirmation depth | ✅ 12 blocks minimum |
| Tx hash replay prevention | ✅ UNIQUE constraint |
| Hunt engine timeout | ✅ 10 min hard limit |
| Secrets in environment | ✅ Never hardcoded |
| Startup orphan recovery | ✅ Marks stale hunts failed |
