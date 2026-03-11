# Answering Service Portal

[![CI](https://github.com/stevembarclay/white-label-customer-portal-answering-services/actions/workflows/ci.yml/badge.svg)](https://github.com/stevembarclay/white-label-customer-portal-answering-services/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

A white-label customer portal for answering service businesses. Deploy it for your clients so they can check their messages, view call transcripts, manage billing, and get set up — all without calling you.

Built with Next.js 15, Supabase, and OpenAI.

---

## Who This Is For

This portal has two parties:

- **Operators** — answering service companies (using Amtelco, StarTel, or similar). You deploy and configure the portal for your clients. You never log in yourself.
- **End users** — your clients (law firms, medical practices, small businesses). They log in to check their messages, read transcripts, and view invoices.

## What It Does

| Feature | Status |
|---------|--------|
| **Setup Wizard** — 7-step onboarding with AI coach (GPT-4o-mini) | Complete |
| **Messages / Call Logs** — transcript viewer with speaker segmentation | UI complete, needs real data source |
| **Dashboard** — call volume, activity feed, balance overview | UI complete, needs real data source |
| **Billing** — invoice table, usage tracking, running estimate | UI complete, needs real data source |
| **Auth** — login, magic link, forgot password | UI complete |

The setup wizard and AI coach are fully functional. The dashboard, messages, and billing pages have complete UIs backed by Supabase — seed demo data to see them in action, then connect your telephony and billing APIs for production.

---

## Quick Start

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project (free tier works)
- An [OpenAI](https://platform.openai.com) API key

### 1. Clone and install

```bash
git clone https://github.com/stevembarclay/white-label-customer-portal-answering-services.git
cd white-label-customer-portal-answering-services
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=       # Supabase project URL (Settings → API)
NEXT_PUBLIC_SUPABASE_ANON_KEY=  # Supabase anon key (Settings → API)
SUPABASE_SERVICE_ROLE_KEY=      # Supabase service role key (server-side only)
OPENAI_API_KEY=                 # OpenAI API key
```

See `.env.example` for all available options including white-label configuration.

### 3. Run migrations

Apply the SQL files in `migrations/` to your Supabase project **in filename order**. You can paste them into the Supabase SQL editor or use the CLI:

```bash
# Using Supabase CLI (if configured)
npx supabase db push
```

> **Important:** Start with `00000000000000_bootstrap.sql` — it creates the foundational `businesses` and `users_businesses` tables that all other migrations depend on.

### 4. Seed demo data (recommended)

```bash
npm run seed
```

Creates a demo business ("Riverside Law Group") with 3 months of realistic call logs, billing periods, and a demo user:

- **Email:** `demo@example.com`
- **Password:** `demo-password-2026`

### 5. Start

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and log in with the demo credentials.

---

## Architecture

### Data scoping

All data is scoped to a `business_id`. Enforced at two levels:

1. **Application layer** — every query passes `businessId` explicitly
2. **Database layer** — Supabase RLS policies enforce tenant isolation

```typescript
const session = await wizardService.getOrCreateSession(businessId, userId)
```

### Service layer

All database operations go through the service layer in `lib/services/answering-service/`. Components never call Supabase directly.

| Service | Purpose | Backing |
|---------|---------|---------|
| `wizardService.ts` | 7-step onboarding wizard | Supabase (live) |
| `billingService.ts` | Invoices, running estimate, billing rules | Supabase (live) |
| `messageService.ts` | Call logs, transcripts, priority, QA flags | Supabase (live) |
| `dashboardService.ts` | Summary stats, unread count, call volume | Supabase (live) |
| `billingEngine.ts` | Pure billing calculation logic | No I/O |

### Connecting your telephony provider

The services above read from Supabase tables (`call_logs`, `billing_periods`, `billing_rules`). To connect a live telephony provider (Amtelco, StarTel, etc.), you have two options:

**Option A: Ingest adapter (recommended).** Write a background job that polls your telephony API and inserts rows into `call_logs`. The portal reads from Supabase as-is. This is the simplest path — you only need to map your provider's data to the `CallLog` type in `types/answeringService.ts`.

**Option B: Direct adapter.** Replace the service functions to call your provider's API directly instead of Supabase. The mock service files (`mockBillingService.ts`, `mockDashboardService.ts`, `mockMessageService.ts`) show the function signatures to implement.

The TypeScript types in `types/answeringService.ts` are the contract — `CallLog`, `BillingInvoice`, `BillingRule`, `DashboardSummary`.

### Auth

Supabase Auth with `getBusinessContext()` (in `lib/auth/server.ts`) returning `{ businessId, userId }` from the session. No public signup — operators provision client accounts.

### Module access guard

All API routes call `checkModuleAccessOrThrow('answering_service')`. For standalone deployments, set `STANDALONE_MODE=true` in `.env.local` — this bypasses the per-module database check while still enforcing authentication.

### AI Coach

`POST /api/answering-service/coach` — context-aware setup assistant powered by GPT-4o-mini (configurable via `OPENAI_MODEL` env var). Includes per-business rate limiting.

### Directory structure

```
app/
  (auth)/                          # Login, forgot password, magic link
  (platform)/answering-service/    # Portal pages (setup, dashboard, billing, messages)
  api/answering-service/           # API routes (coach, dashboard, messages, billing)

components/answering-service/      # All UI components
lib/
  services/answering-service/      # Service layer (business logic + data access)
  design/                          # Design system tokens (typography, color, spacing)
  supabase/                        # Supabase client helpers
  auth/                            # Auth context helpers
  middleware/                      # Rate limiting, module access guard
  utils/                           # Logger, error sanitizer, CORS, cn()

schemas/                           # Zod validation schemas
types/                             # Shared TypeScript types (the adapter contract)
migrations/                        # Supabase SQL migrations (run in order)
scripts/                           # Seed script
docs/                              # PRD, vision, user stories
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| UI | React 19, Tailwind CSS v4, shadcn/ui |
| Icons | Phosphor Icons |
| Database | Supabase (Postgres + RLS) |
| Auth | Supabase Auth |
| AI Coach | OpenAI GPT-4o-mini |
| Validation | Zod + React Hook Form |
| Language | TypeScript (strict) |

---

## Known Issues

| Issue | Notes |
|-------|-------|
| Supabase package type mismatch | `@supabase/ssr@0.6.x` + `@supabase/supabase-js@2.99.x` have incompatible generics. DB clients are untyped. Fix when packages align. |
| Rate limiting | In-memory Map, 10 req/min per business. Replace with Redis/Upstash before production. |
| `npx supabase db push` | May not work if your Supabase CLI isn't configured. Paste SQL files manually into the SQL editor as a fallback. |

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup instructions, project structure, and pull request guidelines.

## Security

See [SECURITY.md](./SECURITY.md) for vulnerability reporting.

## License

MIT — see [LICENSE](./LICENSE).
