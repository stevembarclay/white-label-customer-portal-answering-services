# Contributing

## Prerequisites

- **Node.js 20+**
- A **Supabase** account and project (free tier works fine)
- An **OpenAI API key** (GPT-4o-mini is used — costs are minimal for development)

## Quickstart

1. **Fork and clone**

   ```bash
   git clone https://github.com/<your-username>/white-label-customer-portal-answering-services.git
   cd white-label-customer-portal-answering-services
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment**

   ```bash
   cp .env.example .env.local
   ```

   Fill in `.env.local` with your Supabase project URL, anon key, service role key, and OpenAI API key. See `.env.example` for descriptions of each variable.

4. **Run database migrations**

   Apply the SQL files in `migrations/` to your Supabase project in filename order, starting with `00000000000000_bootstrap.sql`:

   ```
   migrations/
     00000000000000_bootstrap.sql                                    ← START HERE
     20260108125310_create_wizard_sessions.sql
     20260108125400_create_sms_rate_limits.sql
     20260310100000_add_last_login_at_to_users_businesses.sql
     20260310100100_create_call_logs.sql
     20260310100200_create_message_actions.sql
     20260310100300_create_billing_rules.sql
     20260310100400_create_billing_periods.sql
     20260310100500_fix_update_updated_at_search_path.sql
   ```

   You can paste each file into the Supabase SQL editor or use the CLI:

   ```bash
   npx supabase db push
   ```

5. **Seed demo data (recommended)**

   ```bash
   npm run seed
   ```

   Creates a demo user (`demo@example.com` / `demo-password-2026`) with a business, 3 months of call logs, billing periods, and billing rules.

6. **Start the development server**

   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000) and log in with the demo credentials.

## Project Structure

```
app/
  (auth)/                          # Login, forgot password, magic link
  (platform)/answering-service/    # Portal pages (setup, dashboard, billing, messages)
  api/answering-service/           # API routes (coach, dashboard, messages, billing)
components/answering-service/      # All React components
lib/
  services/answering-service/      # Service layer (business logic + data access)
  design/                          # Design system tokens
  supabase/                        # Supabase client helpers
schemas/                           # Zod validation schemas
types/                             # Shared TypeScript types (adapter contract)
migrations/                        # Supabase SQL migrations
scripts/                           # Seed script
docs/                              # Product docs (PRD, vision, user stories)
```

## Integrating Real APIs

The portal reads call logs, billing, and dashboard data from Supabase tables. To connect a live telephony provider:

**Recommended: ingest adapter.** Write a background job that polls your provider's API and inserts rows into `call_logs`. The portal reads from Supabase as-is. Map your data to the `CallLog` type in `types/answeringService.ts`.

**Alternative: direct adapter.** Replace the service functions in `lib/services/answering-service/` to call your provider's API directly. The mock service files show the function signatures:

- `mockBillingService.ts` → billing provider (invoices, payments)
- `mockDashboardService.ts` → telephony + billing (call volume, metrics)
- `mockMessageService.ts` → telephony provider (call logs, transcripts)

## Pull Request Process

1. Fork the repo and create a branch from `main` (e.g. `feature/amtelco-adapter`).
2. Make your changes. Run `npm run typecheck` and `npm run lint` before pushing.
3. Open a pull request with a clear description of what you changed and why.
4. Keep PRs focused — one feature or fix per PR.

## Code Style

- TypeScript strict mode — avoid `any`, use `unknown` with type narrowing
- Service layer pattern — no Supabase calls in components
- All data scoped by `business_id`
- Zod validation at API boundaries
