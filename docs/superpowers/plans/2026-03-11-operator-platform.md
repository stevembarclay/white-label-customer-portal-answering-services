# Operator Platform Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the operator control plane: admin UI with client health scoring, billing ingest pipeline with `usage_periods`-backed meter, REST API surface with Bearer key auth, and webhook delivery.

**Architecture:** Three-layer build. Chunk 1 establishes operator auth middleware and the admin shell with a health-score-computed client list. Chunk 2 migrates the billing engine to read from `usage_periods`, adds the CSV ingest API + UI, and surfaces the billing meter on the client portal. Chunk 3 adds Bearer API key auth, REST endpoints, webhook delivery with retry, and an OpenAPI spec. Operator users share Supabase Auth with client users; differentiation is by `operator_users` row presence.

**Tech Stack:** Next.js 15 (App Router, Server Components), Supabase (Postgres + RLS + service-role API), TypeScript, Zod, Tailwind v4, Jest, Node.js `crypto` (key generation and HMAC signing), `date-fns`.

---

## File Map

### New files

| File | Responsibility |
|------|---------------|
| `types/operator.ts` | OperatorContext, UsagePeriod, ApiKey, WebhookSubscription, BillingRuleTemplate, ClientRow |
| `lib/auth/server.ts` | Extend: `getOperatorContext()`, `checkOperatorAccessOrThrow()` |
| `lib/services/operator/operatorService.ts` | DB queries: client list with health score, client detail, apply billing template |
| `lib/services/operator/usageIngestService.ts` | CSV parse, row validation, upsert logic, billing threshold detection |
| `lib/services/operator/apiKeyService.ts` | `generateApiKey()`, `revokeApiKey()`, `lookupApiKeyByHash()`, `listApiKeys()` |
| `lib/services/operator/webhookService.ts` | Subscription CRUD, `fireWebhook()` (HMAC sign + deliver), retry queue |
| `lib/api/bearerAuth.ts` | `validateBearerToken()` — hash lookup, scope check, IP check, updates `last_used_at` |
| `app/(operator)/operator/layout.tsx` | Operator shell: auth guard + `OperatorNav` |
| `app/(operator)/operator/page.tsx` | Redirect to `/operator/clients` |
| `app/(operator)/operator/clients/page.tsx` | Client list page (Server Component) |
| `app/(operator)/operator/clients/[id]/page.tsx` | Client detail page (Server Component) |
| `app/(operator)/operator/usage/page.tsx` | Billing ingest: upload panel + history |
| `app/(operator)/operator/api-webhooks/page.tsx` | API keys + webhook subscriptions |
| `app/(operator)/operator/settings/page.tsx` | White-label config + billing templates |
| `app/api/v1/calls/route.ts` | `GET /api/v1/calls` |
| `app/api/v1/calls/[id]/route.ts` | `GET /api/v1/calls/:id` |
| `app/api/v1/billing/estimate/route.ts` | `GET /api/v1/billing/estimate` |
| `app/api/v1/billing/invoices/route.ts` | `GET /api/v1/billing/invoices` |
| `app/api/v1/usage/route.ts` | `GET + POST /api/v1/usage` |
| `app/api/v1/webhooks/route.ts` | `GET + POST /api/v1/webhooks` |
| `app/api/v1/webhooks/[id]/route.ts` | `DELETE /api/v1/webhooks/:id` |
| `app/api/v1/openapi.json/route.ts` | `GET /api/v1/openapi.json` — static spec |
| `components/operator/OperatorNav.tsx` | Operator sidebar nav |
| `components/operator/ClientTable.tsx` | Client list table with filters |
| `components/operator/HealthScoreBadge.tsx` | Colored dot + numeric health score |
| `components/operator/ClientDetailTabs.tsx` | Four-tab layout for client detail |
| `components/operator/UsageUploadPanel.tsx` | CSV drop zone + per-business processing status |
| `components/operator/UsageHistory.tsx` | Last 30 uploads table |
| `components/operator/BillingUsageBar.tsx` | Mini and full-size usage progress bar |
| `components/operator/ApiKeyManager.tsx` | Create/revoke API keys list |
| `components/operator/WebhookManager.tsx` | Create/delete webhook subscriptions |

### Modified files

| File | Change |
|------|--------|
| `lib/services/answering-service/billingEngine.ts` | Add `computeEstimate(usagePeriods, billingRules, period, businessCreatedAt, businessId)` using aggregated usage data; keep `calculateBilling` for invoice calcs |
| `lib/services/answering-service/billingService.ts` | `getCurrentEstimate()` fetches `usage_periods` (status='processed') instead of `call_logs` |
| `lib/services/answering-service/__tests__/billingEngine.test.ts` | Add `computeEstimate` test cases |
| `app/(platform)/answering-service/dashboard/AnsweringServiceDashboardClient.tsx` | Add `BillingUsageBar` below existing billing card |
| `app/(platform)/answering-service/billing/BillingClient.tsx` | Update estimate display; show usage periods source note |

---

## Chunk 1: Operator Auth + Admin Shell + Client List

### Task 1: Operator domain types

**Files:**
- Create: `types/operator.ts`

- [ ] **Step 1: Write the types file**

```typescript
// types/operator.ts

export interface OperatorContext {
  operatorOrgId: string
  userId: string
  role: 'admin' | 'viewer'
}

export interface OperatorOrg {
  id: string
  name: string
  slug: string
  plan: 'trial' | 'pro' | 'enterprise'
  status: 'active' | 'suspended' | 'cancelled'
  branding: {
    logo_url?: string
    primary_color?: string
    secondary_color?: string
    custom_domain?: string
  }
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface UsagePeriod {
  id: string
  businessId: string
  operatorOrgId: string
  periodDate: string          // YYYY-MM-DD
  totalCalls: number
  totalMinutes: number        // NUMERIC(10,2) from DB
  callTypeBreakdown: Record<string, { calls: number; minutes: number }>
  source: 'csv_upload' | 'api'
  status: 'pending' | 'processed' | 'error'
  errorDetail: { row?: number; issue?: string } | null
  rawFileUrl: string | null
  processedAt: string | null
  createdAt: string
}

export interface ApiKey {
  id: string
  businessId: string | null
  operatorOrgId: string | null
  label: string
  scopes: string[]
  allowedIps: string[] | null
  expiresAt: string | null
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

export interface WebhookSubscription {
  id: string
  operatorOrgId: string
  url: string
  // secret is NEVER included in this type — write-only at DB level
  topics: string[]
  status: 'active' | 'paused' | 'failing'
  consecutiveFailureCount: number
  createdAt: string
  updatedAt: string
}

export interface WebhookDelivery {
  id: string
  subscriptionId: string
  topic: string
  payload: Record<string, unknown>
  responseStatus: number | null
  responseBody: string | null
  attemptNumber: number
  nextRetryAt: string | null
  deliveredAt: string | null
  createdAt: string
}

export interface ClientRow {
  id: string
  name: string
  domain?: string
  operatorOrgId: string
  healthScore: number
  isHealthScoreOverride: boolean
  lastLoginAt: string | null
  callsPerWeek: number
  billingPercent: number | null   // null if no bucket rule; 0–100+ otherwise
  churnedAt: string | null
}

export interface ClientHealthBreakdown {
  total: number
  loginRecency: number            // 0 | 10 | 25 | 40
  unresolvedHighPriority: number  // 0 | 15 | 30
  reviewedWithin7d: number        // 0 | 10 | 20
  onboardingComplete: number      // 0 | 10
  isOverride: boolean
}

export interface BillingRuleTemplate {
  id: string
  operatorOrgId: string
  name: string
  description?: string
  rules: Array<{
    type: string
    name: string
    amount: number
    active: boolean
    callTypeFilter?: string[]
    includedMinutes?: number
    overageRate?: number
  }>
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 2: Commit**

```bash
git add types/operator.ts
git commit -m "feat: add operator platform domain types"
```

---

### Task 2: Operator auth context helpers

**Files:**
- Modify: `lib/auth/server.ts`
- Create: `lib/auth/__tests__/operatorContext.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/auth/__tests__/operatorContext.test.ts
import { getOperatorContext } from '@/lib/auth/server'

const mockCreateClient = jest.fn()
jest.mock('@/lib/supabase/server', () => ({
  createClient: () => mockCreateClient(),
}))

afterEach(() => jest.resetAllMocks())

describe('getOperatorContext', () => {
  it('returns null when unauthenticated (no session user)', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    })
    expect(await getOperatorContext()).toBeNull()
  })

  it('returns null when authenticated but has no operator_users row', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) },
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
      }),
    })
    expect(await getOperatorContext()).toBeNull()
  })

  it('returns context with correct role — no fallback default applied', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) },
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { operator_org_id: 'org-1', role: 'admin' },
          error: null,
        }),
      }),
    })
    const ctx = await getOperatorContext()
    expect(ctx).not.toBeNull()
    expect(ctx!.role).toBe('admin')
    expect(ctx!.operatorOrgId).toBe('org-1')
  })

  it('returns null for an unrecognized role value (defensive — no fallback to "member")', async () => {
    mockCreateClient.mockResolvedValue({
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }) },
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { operator_org_id: 'org-1', role: 'superadmin' },  // invalid role
          error: null,
        }),
      }),
    })
    expect(await getOperatorContext()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest lib/auth/__tests__/operatorContext.test.ts --no-coverage
```

Expected: FAIL — `getOperatorContext is not a function`

- [ ] **Step 3: Implement in `lib/auth/server.ts`**

Add after the existing `getUser` export:

```typescript
import type { OperatorContext } from '@/types/operator'

/**
 * Gets the operator context for the current Supabase session.
 * Returns null if the user has no operator_users row.
 * Never throws.
 */
export async function getOperatorContext(): Promise<OperatorContext | null> {
  try {
    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) return null

    const { data: membership, error: memberError } = await supabase
      .from('operator_users')
      .select('operator_org_id, role')
      .eq('user_id', user.id)
      .limit(1)
      .single()

    if (memberError || !membership) return null

    // Defensive: reject unrecognized roles — do NOT add a fallback default like ?? 'member'
    // (contrast: getBusinessContext() uses ?? 'member', which is wrong to copy here)
    const role = membership.role as string
    if (role !== 'admin' && role !== 'viewer') return null
    return {
      operatorOrgId: membership.operator_org_id as string,
      userId: user.id,
      role: role as 'admin' | 'viewer',
    }
  } catch {
    return null
  }
}

/**
 * For use in Next.js Server Components and route handlers.
 * Calls redirect('/login') if the user has no operator context.
 * Returns the operator context when the user is authenticated.
 */
export async function checkOperatorAccessOrThrow(): Promise<OperatorContext> {
  const { redirect } = await import('next/navigation')
  const context = await getOperatorContext()
  if (!context) {
    redirect('/login')
  }
  return context
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest lib/auth/__tests__/operatorContext.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 5: Run the full test suite to confirm no regressions**

```bash
npx jest --no-coverage
```

Expected: all existing tests pass

- [ ] **Step 6: Commit**

```bash
git add lib/auth/server.ts lib/auth/__tests__/operatorContext.test.ts
git commit -m "feat: add getOperatorContext and checkOperatorAccessOrThrow"
```

---

### Task 3: Operator admin shell (layout + nav + route stubs)

**Files:**
- Create: `components/operator/OperatorNav.tsx`
- Create: `app/(operator)/operator/layout.tsx`
- Create: `app/(operator)/operator/page.tsx`
- Create: `app/(operator)/operator/clients/page.tsx` (stub)
- Create: `app/(operator)/operator/clients/[id]/page.tsx` (stub)
- Create: `app/(operator)/operator/usage/page.tsx` (stub)
- Create: `app/(operator)/operator/api-webhooks/page.tsx` (stub)
- Create: `app/(operator)/operator/settings/page.tsx` (stub)

- [ ] **Step 1: Create `components/operator/OperatorNav.tsx`**

```tsx
// components/operator/OperatorNav.tsx
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const navItems = [
  { href: '/operator/clients', label: 'Clients' },
  { href: '/operator/usage', label: 'Usage' },
  { href: '/operator/api-webhooks', label: 'API & Webhooks' },
  { href: '/operator/settings', label: 'Settings' },
]

export function OperatorNav({ orgName }: { orgName: string }) {
  return (
    <nav className="hidden md:flex w-48 flex-col shrink-0 gap-1 pt-1">
      <div className="mb-4 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
        {orgName}
      </div>
      {navItems.map((item) => (
        <NavLink key={item.href} href={item.href} label={item.label} />
      ))}
    </nav>
  )
}

// Separate client component for active state
'use client'
function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname()
  const isActive = pathname.startsWith(href)
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
        isActive
          ? 'bg-slate-100 text-slate-900'
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      {label}
    </Link>
  )
}
```

Note: `OperatorNav` is a Server Component; `NavLink` is client-only for `usePathname`. Split into two files if the linter complains about mixing directives.

- [ ] **Step 2: Create `app/(operator)/operator/layout.tsx`**

```tsx
// app/(operator)/operator/layout.tsx
import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'
import { OperatorNav } from '@/components/operator/OperatorNav'

export default async function OperatorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const context = await checkOperatorAccessOrThrow()

  const supabase = await createClient()
  const { data: org } = await supabase
    .from('operator_orgs')
    .select('name')
    .eq('id', context.operatorOrgId)
    .single()

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6 md:px-6">
        <OperatorNav orgName={org?.name ?? 'Operator'} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create redirect page and all route stubs**

```tsx
// app/(operator)/operator/page.tsx
import { redirect } from 'next/navigation'
export default function OperatorRoot() {
  redirect('/operator/clients')
}
```

For each stub page (clients, clients/[id], usage, api-webhooks, settings):

```tsx
// app/(operator)/operator/clients/page.tsx
export default function ClientsPage() {
  return <div>Clients — coming soon</div>
}
```

Create five identical stubs with appropriate page names. These will be replaced in subsequent tasks.

- [ ] **Step 4: Manual smoke test**

Navigate to `/operator/clients` as a non-operator user → should redirect to `/login`.
Navigate as an operator user → should see the operator layout with nav.

**Role enforcement:** The layout gate (`checkOperatorAccessOrThrow`) ensures only operator users get in. Write operations (CSV upload, key creation, template apply, webhook management, health score override, settings changes) must additionally check `context.role === 'admin'` at the handler/action level. Viewer-only access is enforced by returning 403 (API routes) or rendering read-only UI (pages). The following routes have admin-only write paths that must be gated:
- `/operator/usage` — upload CSV action
- `/operator/api-webhooks` — create/revoke key and create/delete webhook subscription actions
- `/operator/settings` — save settings / apply billing template actions
- `/operator/clients/[id]` — health score override save action

Each server action and API route handler at these paths must include: `if (context.role !== 'admin') return 403/redirect`. Pages can use `context.role` to conditionally render write controls.

- [ ] **Step 5: Commit**

```bash
git add components/operator/OperatorNav.tsx \
  "app/(operator)/operator/layout.tsx" \
  "app/(operator)/operator/page.tsx" \
  "app/(operator)/operator/clients/page.tsx" \
  "app/(operator)/operator/clients/[id]/page.tsx" \
  "app/(operator)/operator/usage/page.tsx" \
  "app/(operator)/operator/api-webhooks/page.tsx" \
  "app/(operator)/operator/settings/page.tsx"
git commit -m "feat: operator admin shell with auth guard and nav"
```

---

### Task 4: Client list with health score

**Files:**
- Create: `lib/services/operator/operatorService.ts`
- Create: `lib/services/operator/__tests__/healthScore.test.ts`
- Create: `components/operator/ClientTable.tsx`
- Create: `components/operator/HealthScoreBadge.tsx`
- Modify: `app/(operator)/operator/clients/page.tsx`

**Health score formula:**
| Component | Max | Condition |
|-----------|-----|-----------|
| Login recency | 40 | 40 → ≤7d; 25 → 8–14d; 10 → 15–30d; 0 → >30d |
| Unresolved high-priority | 30 | 30 → 0 open; 15 → 1–2; 0 → 3+ |
| Reviewed within 7d | 20 | % of high-priority calls in last 30d with `status_changed` action within 7d of call; 20 → ≥80%; 10 → 50–79%; 0 → <50% |
| Onboarding complete | 10 | 10 → wizard status='completed'; 0 → otherwise |

- [ ] **Step 1: Write failing health score unit tests**

```typescript
// lib/services/operator/__tests__/healthScore.test.ts
import { computeHealthScore } from '@/lib/services/operator/operatorService'

const NOW = new Date('2026-03-11T12:00:00Z')

describe('computeHealthScore', () => {
  it('perfect score: recent login, no open high-priority, all reviewed, onboarded', () => {
    const score = computeHealthScore({
      daysSinceLastLogin: 3,
      openHighPriorityCount: 0,
      reviewedWithin7dPercent: 100,
      onboardingComplete: true,
      override: null,
    })
    expect(score.total).toBe(100)
    expect(score.loginRecency).toBe(40)
    expect(score.unresolvedHighPriority).toBe(30)
    expect(score.reviewedWithin7d).toBe(20)
    expect(score.onboardingComplete).toBe(10)
    expect(score.isOverride).toBe(false)
  })

  it('override value is returned as-is', () => {
    const score = computeHealthScore({
      daysSinceLastLogin: 60,
      openHighPriorityCount: 5,
      reviewedWithin7dPercent: 0,
      onboardingComplete: false,
      override: 72,
    })
    expect(score.total).toBe(72)
    expect(score.isOverride).toBe(true)
  })

  it('login recency: 8-14 days → 25 pts', () => {
    const score = computeHealthScore({
      daysSinceLastLogin: 10,
      openHighPriorityCount: 0,
      reviewedWithin7dPercent: 100,
      onboardingComplete: true,
      override: null,
    })
    expect(score.loginRecency).toBe(25)
    expect(score.total).toBe(85)
  })

  it('2 open high-priority → 15 pts', () => {
    const score = computeHealthScore({
      daysSinceLastLogin: 3,
      openHighPriorityCount: 2,
      reviewedWithin7dPercent: 100,
      onboardingComplete: true,
      override: null,
    })
    expect(score.unresolvedHighPriority).toBe(15)
  })

  it('60% reviewed → 10 pts', () => {
    const score = computeHealthScore({
      daysSinceLastLogin: 3,
      openHighPriorityCount: 0,
      reviewedWithin7dPercent: 60,
      onboardingComplete: true,
      override: null,
    })
    expect(score.reviewedWithin7d).toBe(10)
  })

  it('null lastLogin (never logged in) → 0 login pts', () => {
    const score = computeHealthScore({
      daysSinceLastLogin: null,
      openHighPriorityCount: 0,
      reviewedWithin7dPercent: 100,
      onboardingComplete: true,
      override: null,
    })
    expect(score.loginRecency).toBe(0)
  })

  // Boundary tests for reviewedWithin7d — catch off-by-one in >= vs > comparisons
  it('reviewedWithin7dPercent at 50% boundary → 10 pts (inclusive lower bound)', () => {
    const score = computeHealthScore({
      daysSinceLastLogin: 3, openHighPriorityCount: 0,
      reviewedWithin7dPercent: 50, onboardingComplete: true, override: null,
    })
    expect(score.reviewedWithin7d).toBe(10)
  })

  it('reviewedWithin7dPercent at 49% → 0 pts (just below 50% lower bound)', () => {
    const score = computeHealthScore({
      daysSinceLastLogin: 3, openHighPriorityCount: 0,
      reviewedWithin7dPercent: 49, onboardingComplete: true, override: null,
    })
    expect(score.reviewedWithin7d).toBe(0)
  })

  it('reviewedWithin7dPercent at 80% boundary → 20 pts (inclusive lower bound for top tier)', () => {
    const score = computeHealthScore({
      daysSinceLastLogin: 3, openHighPriorityCount: 0,
      reviewedWithin7dPercent: 80, onboardingComplete: true, override: null,
    })
    expect(score.reviewedWithin7d).toBe(20)
  })

  it('reviewedWithin7dPercent at 79% → 10 pts (just below 80% upper bound)', () => {
    const score = computeHealthScore({
      daysSinceLastLogin: 3, openHighPriorityCount: 0,
      reviewedWithin7dPercent: 79, onboardingComplete: true, override: null,
    })
    expect(score.reviewedWithin7d).toBe(10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest lib/services/operator/__tests__/healthScore.test.ts --no-coverage
```

Expected: FAIL — `computeHealthScore is not a function`

- [ ] **Step 3: Create `lib/services/operator/operatorService.ts`** with pure `computeHealthScore` and DB query functions

```typescript
// lib/services/operator/operatorService.ts
import { createClient } from '@/lib/supabase/server'
import type { ClientHealthBreakdown, ClientRow } from '@/types/operator'

// ─── Pure computation ────────────────────────────────────────────────────────

interface HealthScoreInputs {
  daysSinceLastLogin: number | null  // null = never logged in
  openHighPriorityCount: number
  reviewedWithin7dPercent: number    // 0–100
  onboardingComplete: boolean
  override: number | null
}

export function computeHealthScore(inputs: HealthScoreInputs): ClientHealthBreakdown {
  if (inputs.override !== null) {
    return {
      total: inputs.override,
      loginRecency: 0,
      unresolvedHighPriority: 0,
      reviewedWithin7d: 0,
      onboardingComplete: 0,
      isOverride: true,
    }
  }

  const loginRecency =
    inputs.daysSinceLastLogin === null ? 0
    : inputs.daysSinceLastLogin <= 7 ? 40
    : inputs.daysSinceLastLogin <= 14 ? 25
    : inputs.daysSinceLastLogin <= 30 ? 10
    : 0

  const unresolvedHighPriority =
    inputs.openHighPriorityCount === 0 ? 30
    : inputs.openHighPriorityCount <= 2 ? 15
    : 0

  const reviewedWithin7d =
    inputs.reviewedWithin7dPercent >= 80 ? 20
    : inputs.reviewedWithin7dPercent >= 50 ? 10
    : 0

  const onboardingComplete = inputs.onboardingComplete ? 10 : 0

  return {
    total: loginRecency + unresolvedHighPriority + reviewedWithin7d + onboardingComplete,
    loginRecency,
    unresolvedHighPriority,
    reviewedWithin7d,
    onboardingComplete,
    isOverride: false,
  }
}

// ─── DB queries ──────────────────────────────────────────────────────────────

/**
 * Returns all non-churned clients for the operator org with computed health scores.
 * Health score inputs are fetched via individual aggregation queries per business.
 *
 * Performance note: this runs N+1 queries for N clients. Acceptable for initial
 * operator adoption (< 100 clients). Add a denormalized `health_score` column
 * once P95 latency becomes an issue.
 */
export async function getClientsWithHealthScores(
  operatorOrgId: string
): Promise<ClientRow[]> {
  const supabase = await createClient()

  const { data: businesses, error } = await supabase
    .from('businesses')
    .select('id, name, operator_org_id, health_score_override, churned_at')
    .eq('operator_org_id', operatorOrgId)
    .is('churned_at', null)
    .order('name', { ascending: true })

  if (error) throw new Error('Failed to load clients.')

  const now = new Date()
  const rows: ClientRow[] = []

  for (const biz of businesses ?? []) {
    // Login recency: equivalent to MAX(last_login_at) across ALL users on this business.
    // ORDER DESC + LIMIT 1 achieves the same result as an aggregate MAX().
    // IMPORTANT: do NOT filter by user_id here — we want the most recent login by any user.
    const { data: loginData } = await supabase
      .from('users_businesses')
      .select('last_login_at')
      .eq('business_id', biz.id)
      .order('last_login_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    const lastLoginAt = loginData?.last_login_at ?? null
    const daysSinceLastLogin = lastLoginAt
      ? Math.floor((now.getTime() - new Date(lastLoginAt).getTime()) / 86_400_000)
      : null

    // Unresolved high-priority open calls
    const { count: openHighCount } = await supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', biz.id)
      .eq('priority', 'high')
      .not('portal_status', 'in', '("resolved","read")')

    // High-priority reviewed within 7d: % of calls in last 30d with a status_changed action
    // within 7 days of the call timestamp
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString()
    const { data: highPriorityCalls } = await supabase
      .from('call_logs')
      .select('id, timestamp, actions:message_actions(type, at)')
      .eq('business_id', biz.id)
      .eq('priority', 'high')
      .gte('timestamp', thirtyDaysAgo)

    let reviewedCount = 0
    const totalHighPriority = (highPriorityCalls ?? []).length
    for (const call of highPriorityCalls ?? []) {
      const callTs = new Date(call.timestamp).getTime()
      const sevenDaysAfter = callTs + 7 * 86_400_000
      const hasReview = (call.actions as Array<{ type: string; at: string }>).some(
        (a) => a.type === 'status_changed' && new Date(a.at).getTime() <= sevenDaysAfter
      )
      if (hasReview) reviewedCount++
    }
    const reviewedPercent = totalHighPriority > 0
      ? Math.round((reviewedCount / totalHighPriority) * 100)
      : 100  // no high-priority calls → full credit

    // Onboarding complete
    const { data: wizard } = await supabase
      .from('answering_service_wizard_sessions')
      .select('status')
      .eq('business_id', biz.id)
      .maybeSingle()
    const onboardingComplete = wizard?.status === 'completed'

    // Calls per week (last 7 days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString()
    const { count: callsPerWeek } = await supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', biz.id)
      .gte('timestamp', sevenDaysAgo)

    // Billing usage percent: sum processed usage_periods for current calendar month
    // for any bucket-type billing rule
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10)
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10)

    const { data: bucketRule } = await supabase
      .from('billing_rules')
      .select('included_minutes')
      .eq('business_id', biz.id)
      .eq('type', 'bucket')
      .eq('active', true)
      .limit(1)
      .maybeSingle()

    let billingPercent: number | null = null
    if (bucketRule?.included_minutes) {
      const { data: usagePeriods } = await supabase
        .from('usage_periods')
        .select('total_minutes')
        .eq('business_id', biz.id)
        .eq('status', 'processed')
        .gte('period_date', monthStart)
        .lte('period_date', monthEnd)

      const totalMinutes = (usagePeriods ?? []).reduce(
        (sum, row) => sum + Number(row.total_minutes),
        0
      )
      billingPercent = Math.round((totalMinutes / bucketRule.included_minutes) * 100)
    }

    const healthScore = computeHealthScore({
      daysSinceLastLogin,
      openHighPriorityCount: openHighCount ?? 0,
      reviewedWithin7dPercent: reviewedPercent,
      onboardingComplete,
      override: (biz.health_score_override as number | null) ?? null,
    })

    rows.push({
      id: biz.id,
      name: biz.name as string,
      operatorOrgId: biz.operator_org_id as string,
      healthScore: healthScore.total,
      isHealthScoreOverride: healthScore.isOverride,
      lastLoginAt: lastLoginAt,
      callsPerWeek: callsPerWeek ?? 0,
      billingPercent,
      churnedAt: null,
    })
  }

  return rows
}
```

- [ ] **Step 4: Run health score tests to verify they pass**

```bash
npx jest lib/services/operator/__tests__/healthScore.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 5: Create `components/operator/HealthScoreBadge.tsx`**

```tsx
// components/operator/HealthScoreBadge.tsx
export function HealthScoreBadge({
  score,
  isOverride = false,
}: {
  score: number
  isOverride?: boolean
}) {
  const color =
    score >= 70 ? 'bg-green-500'
    : score >= 50 ? 'bg-yellow-500'
    : 'bg-red-500'

  return (
    <span className="flex items-center gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      <span className="tabular-nums text-sm font-medium">{score}</span>
      {isOverride && (
        <span className="text-slate-400" title="Score manually overridden">📌</span>
      )}
    </span>
  )
}
```

- [ ] **Step 6: Create `components/operator/ClientTable.tsx`**

```tsx
// components/operator/ClientTable.tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { HealthScoreBadge } from '@/components/operator/HealthScoreBadge'
import type { ClientRow } from '@/types/operator'
import { formatDistanceToNow } from 'date-fns'

type Segment = 'all' | 'at_risk' | 'inactive'
type SortKey = 'health_asc' | 'health_desc' | 'name' | 'last_login' | 'calls'

export function ClientTable({ clients }: { clients: ClientRow[] }) {
  const [segment, setSegment] = useState<Segment>('all')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('health_asc')

  const now = new Date()

  const filtered = clients
    .filter((c) => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false
      if (segment === 'at_risk' && c.healthScore >= 50) return false
      if (segment === 'inactive') {
        if (!c.lastLoginAt) return true  // never logged in → inactive
        const daysSince = (now.getTime() - new Date(c.lastLoginAt).getTime()) / 86_400_000
        if (daysSince <= 30) return false
      }
      return true
    })
    .sort((a, b) => {
      switch (sortKey) {
        case 'health_asc':  return a.healthScore - b.healthScore
        case 'health_desc': return b.healthScore - a.healthScore
        case 'name':        return a.name.localeCompare(b.name)
        case 'last_login':  return (b.lastLoginAt ?? '').localeCompare(a.lastLoginAt ?? '')
        case 'calls':       return b.callsPerWeek - a.callsPerWeek
        default:            return 0
      }
    })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search clients…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
        <div className="flex rounded-md border border-slate-200 text-sm">
          {(['all', 'at_risk', 'inactive'] as Segment[]).map((s) => (
            <button
              key={s}
              onClick={() => setSegment(s)}
              className={`px-3 py-1.5 first:rounded-l-md last:rounded-r-md ${
                segment === s ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {s === 'all' ? 'All' : s === 'at_risk' ? 'At risk' : 'Inactive'}
            </button>
          ))}
        </div>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm"
        >
          <option value="health_asc">Health: low → high</option>
          <option value="health_desc">Health: high → low</option>
          <option value="name">Name A–Z</option>
          <option value="last_login">Most recently active</option>
          <option value="calls">Most calls/wk</option>
        </select>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="pb-2 pr-4 font-medium">Client</th>
            <th className="pb-2 pr-4 font-medium">Health</th>
            <th className="pb-2 pr-4 font-medium">Last login</th>
            <th className="pb-2 pr-4 font-medium">Calls/wk</th>
            <th className="pb-2 pr-4 font-medium">Billing</th>
            <th className="pb-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {filtered.map((client) => (
            <tr key={client.id} className="border-b border-slate-100">
              <td className="py-3 pr-4 font-medium">{client.name}</td>
              <td className="py-3 pr-4">
                <HealthScoreBadge score={client.healthScore} isOverride={client.isHealthScoreOverride} />
              </td>
              <td className="py-3 pr-4 text-slate-500">
                {client.lastLoginAt
                  ? formatDistanceToNow(new Date(client.lastLoginAt), { addSuffix: true })
                  : 'Never'}
              </td>
              <td className="py-3 pr-4 tabular-nums">{client.callsPerWeek}</td>
              <td className="py-3 pr-4">
                {client.billingPercent !== null ? (
                  <span className="tabular-nums">{client.billingPercent}%</span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="py-3">
                <Link
                  href={`/operator/clients/${client.id}`}
                  className="text-slate-500 hover:text-slate-900"
                >
                  View →
                </Link>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="py-8 text-center text-slate-400">
                No clients match the current filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 7: Wire up `app/(operator)/operator/clients/page.tsx`**

```tsx
// app/(operator)/operator/clients/page.tsx
import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import { getClientsWithHealthScores } from '@/lib/services/operator/operatorService'
import { ClientTable } from '@/components/operator/ClientTable'

export default async function ClientsPage() {
  const context = await checkOperatorAccessOrThrow()
  const clients = await getClientsWithHealthScores(context.operatorOrgId)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Clients</h1>
      <ClientTable clients={clients} />
    </div>
  )
}
```

- [ ] **Step 8: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass

- [ ] **Step 9: Commit**

```bash
git add lib/services/operator/ components/operator/ "app/(operator)/"
git commit -m "feat: operator client list with health score computation"
```

---

## 🔍 Review Checkpoint 0 — After Chunk 1

Return to Claude Code before continuing:

- Run `npx jest --no-coverage` — all tests must pass (health score boundary tests especially)
- Manually navigate `/operator/clients` — client list renders with colored health scores and sort dropdown
- Confirm non-operator user is redirected to `/login`
- Confirm viewer-role user sees read-only UI (no upload button, no write controls)
- Sign off before starting Chunk 2

---

## Chunk 2: Client Detail + billingEngine Update + Billing Ingest Pipeline

### Task 5: Client detail page (Overview + Settings + Billing + Calls tabs)

**Files:**
- Create: `lib/services/operator/operatorService.ts` (extend — add `getClientDetail`)
- Create: `components/operator/ClientDetailTabs.tsx`
- Modify: `app/(operator)/operator/clients/[id]/page.tsx`

- [ ] **Step 1: Add `getClientDetail` to `operatorService.ts`**

Add after `getClientsWithHealthScores`:

```typescript
export interface ClientDetail {
  id: string
  name: string
  healthBreakdown: ClientHealthBreakdown
  lastLoginAt: string | null
  openHighPriorityCount: number
  callsThisMonth: number
  callsLastMonth: number
  onboardingStatus: string | null
  billingRules: Array<{ id: string; type: string; name: string; amount: number; active: boolean }>
  recentCalls: Array<{ id: string; timestamp: string; callType: string; priority: string; portalStatus: string; message: string }>
  apiKeys: Array<{ id: string; label: string; scopes: string[]; createdAt: string; revokedAt: string | null }>
  healthScoreOverride: number | null
}

export async function getClientDetail(
  businessId: string,
  operatorOrgId: string
): Promise<ClientDetail | null> {
  const supabase = await createClient()

  // Verify business belongs to this operator
  const { data: biz, error } = await supabase
    .from('businesses')
    .select('id, name, health_score_override, operator_org_id')
    .eq('id', businessId)
    .eq('operator_org_id', operatorOrgId)
    .maybeSingle()

  if (error || !biz) return null

  const now = new Date()

  // Last login
  const { data: loginData } = await supabase
    .from('users_businesses')
    .select('last_login_at')
    .eq('business_id', businessId)
    .order('last_login_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const lastLoginAt = loginData?.last_login_at ?? null
  const daysSinceLastLogin = lastLoginAt
    ? Math.floor((now.getTime() - new Date(lastLoginAt).getTime()) / 86_400_000)
    : null

  // Open high-priority
  const { count: openHighCount } = await supabase
    .from('call_logs')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('priority', 'high')
    .not('portal_status', 'in', '("resolved","read")')

  // Reviewed within 7d (same logic as list)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString()
  const { data: highCalls } = await supabase
    .from('call_logs')
    .select('id, timestamp, actions:message_actions(type, at)')
    .eq('business_id', businessId)
    .eq('priority', 'high')
    .gte('timestamp', thirtyDaysAgo)

  let reviewedCount = 0
  const totalHigh = (highCalls ?? []).length
  for (const call of highCalls ?? []) {
    const callTs = new Date(call.timestamp).getTime()
    const sevenDaysAfter = callTs + 7 * 86_400_000
    const hasReview = (call.actions as Array<{ type: string; at: string }>).some(
      (a) => a.type === 'status_changed' && new Date(a.at).getTime() <= sevenDaysAfter
    )
    if (hasReview) reviewedCount++
  }
  const reviewedPercent = totalHigh > 0 ? Math.round((reviewedCount / totalHigh) * 100) : 100

  // Onboarding
  const { data: wizard } = await supabase
    .from('answering_service_wizard_sessions')
    .select('status')
    .eq('business_id', businessId)
    .maybeSingle()

  // Calls this month vs last month
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString()
  const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59)).toISOString()

  const [{ count: callsThisMonth }, { count: callsLastMonth }] = await Promise.all([
    supabase.from('call_logs').select('id', { count: 'exact', head: true })
      .eq('business_id', businessId).gte('timestamp', monthStart),
    supabase.from('call_logs').select('id', { count: 'exact', head: true })
      .eq('business_id', businessId).gte('timestamp', lastMonthStart).lte('timestamp', lastMonthEnd),
  ])

  // Billing rules
  const { data: billingRules } = await supabase
    .from('billing_rules')
    .select('id, type, name, amount, active')
    .eq('business_id', businessId)
    .order('created_at', { ascending: true })

  // Recent calls (last 10, read-only)
  const { data: recentCalls } = await supabase
    .from('call_logs')
    .select('id, timestamp, call_type, priority, portal_status, message')
    .eq('business_id', businessId)
    .order('timestamp', { ascending: false })
    .limit(10)

  // API keys for this business
  const { data: apiKeys } = await supabase
    .from('api_keys')
    .select('id, label, scopes, created_at, revoked_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })

  const healthScore = computeHealthScore({
    daysSinceLastLogin,
    openHighPriorityCount: openHighCount ?? 0,
    reviewedWithin7dPercent: reviewedPercent,
    onboardingComplete: wizard?.status === 'completed',
    override: (biz.health_score_override as number | null) ?? null,
  })

  return {
    id: biz.id,
    name: biz.name as string,
    healthBreakdown: healthScore,
    lastLoginAt,
    openHighPriorityCount: openHighCount ?? 0,
    callsThisMonth: callsThisMonth ?? 0,
    callsLastMonth: callsLastMonth ?? 0,
    onboardingStatus: wizard?.status ?? null,
    billingRules: (billingRules ?? []) as ClientDetail['billingRules'],
    recentCalls: (recentCalls ?? []).map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      callType: r.call_type,
      priority: r.priority,
      portalStatus: r.portal_status,
      message: r.message,
    })),
    apiKeys: (apiKeys ?? []).map((k) => ({
      id: k.id,
      label: k.label,
      scopes: (k.scopes as string[]) ?? [],
      createdAt: k.created_at,
      revokedAt: k.revoked_at ?? null,
    })),
    healthScoreOverride: (biz.health_score_override as number | null) ?? null,
  }
}
```

- [ ] **Step 2: Create `components/operator/ClientDetailTabs.tsx`**

```tsx
// components/operator/ClientDetailTabs.tsx
'use client'

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { HealthScoreBadge } from '@/components/operator/HealthScoreBadge'
import { formatDistanceToNow } from 'date-fns'
import type { ClientDetail } from '@/lib/services/operator/operatorService'

export function ClientDetailTabs({ client }: { client: ClientDetail }) {
  const { healthBreakdown: hs } = client

  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="billing">Billing</TabsTrigger>
        <TabsTrigger value="calls">Calls</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4 pt-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <ScoreCard label="Login recency" value={hs.loginRecency} max={40} />
          <ScoreCard label="Open high-priority" value={hs.unresolvedHighPriority} max={30} />
          <ScoreCard label="Reviewed in 7d" value={hs.reviewedWithin7d} max={20} />
          <ScoreCard label="Onboarding" value={hs.onboardingComplete} max={10} />
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <dt className="text-slate-500">Last login</dt>
          <dd>{client.lastLoginAt
            ? formatDistanceToNow(new Date(client.lastLoginAt), { addSuffix: true })
            : 'Never'}</dd>
          <dt className="text-slate-500">Open high-priority calls</dt>
          <dd>{client.openHighPriorityCount}</dd>
          <dt className="text-slate-500">Calls this month</dt>
          <dd>{client.callsThisMonth} (vs {client.callsLastMonth} last month)</dd>
          <dt className="text-slate-500">Onboarding</dt>
          <dd>{client.onboardingStatus ?? 'Not started'}</dd>
        </dl>
      </TabsContent>

      <TabsContent value="billing" className="pt-4">
        {/* Expanded in Task 7 — shows usage periods and billing estimate */}
        <p className="text-sm text-slate-500">Usage data will appear here once billing ingest is set up.</p>
        <div className="mt-4 space-y-2">
          {client.billingRules.map((rule) => (
            <div key={rule.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
              <span className="font-medium">{rule.name}</span>
              <span className="ml-2 text-slate-500">{rule.type}</span>
              {!rule.active && <span className="ml-2 text-orange-500">(inactive)</span>}
            </div>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="calls" className="pt-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="pb-2 pr-4 font-medium">Time</th>
              <th className="pb-2 pr-4 font-medium">Type</th>
              <th className="pb-2 pr-4 font-medium">Priority</th>
              <th className="pb-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {client.recentCalls.map((call) => (
              <tr key={call.id} className="border-b border-slate-100">
                <td className="py-2 pr-4 text-slate-500">
                  {formatDistanceToNow(new Date(call.timestamp), { addSuffix: true })}
                </td>
                <td className="py-2 pr-4">{call.callType}</td>
                <td className="py-2 pr-4">{call.priority}</td>
                <td className="py-2">{call.portalStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TabsContent>

      <TabsContent value="settings" className="space-y-6 pt-4">
        <div>
          <h3 className="mb-2 text-sm font-semibold">API Keys</h3>
          {client.apiKeys.filter((k) => !k.revokedAt).map((key) => (
            <div key={key.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
              <span className="font-medium">{key.label}</span>
              <span className="ml-2 text-slate-400">{key.scopes.join(', ')}</span>
            </div>
          ))}
          {client.apiKeys.filter((k) => !k.revokedAt).length === 0 && (
            <p className="text-sm text-slate-400">No active API keys.</p>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Health Score Override</h3>
          <p className="text-sm text-slate-500">
            {client.healthScoreOverride !== null
              ? `Currently overridden to ${client.healthScoreOverride}`
              : 'No override — formula score is used.'}
          </p>
        </div>
      </TabsContent>
    </Tabs>
  )
}

function ScoreCard({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="rounded-md border border-slate-200 p-3 text-center">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-slate-500">/{max} {label}</div>
    </div>
  )
}
```

- [ ] **Step 3: Wire up `app/(operator)/operator/clients/[id]/page.tsx`**

```tsx
// app/(operator)/operator/clients/[id]/page.tsx
import { notFound } from 'next/navigation'
import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import { getClientDetail } from '@/lib/services/operator/operatorService'
import { ClientDetailTabs } from '@/components/operator/ClientDetailTabs'
import { HealthScoreBadge } from '@/components/operator/HealthScoreBadge'

export default async function ClientDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const context = await checkOperatorAccessOrThrow()
  const client = await getClientDetail(params.id, context.operatorOrgId)

  if (!client) notFound()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{client.name}</h1>
        </div>
        <HealthScoreBadge
          score={client.healthBreakdown.total}
          isOverride={client.healthBreakdown.isOverride}
        />
      </div>
      <ClientDetailTabs client={client} />
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add lib/services/operator/operatorService.ts components/operator/ "app/(operator)/operator/clients/"
git commit -m "feat: operator client detail page with four-tab layout"
```

---

### Task 6: billingEngine — swap `call_logs` input for `usage_periods`

**Files:**
- Modify: `lib/services/answering-service/billingEngine.ts`
- Modify: `lib/services/answering-service/__tests__/billingEngine.test.ts`
- Modify: `lib/services/answering-service/billingService.ts`

The new `computeEstimate` aggregates totals from `UsagePeriod[]`. For rules with a `callTypeFilter`, it sums the matching `callTypeBreakdown` values. `calculateBilling` (from `CallLog[]`) is preserved for `calculateInvoice`.

- [ ] **Step 1: Write failing tests for `computeEstimate`**

Add to `lib/services/answering-service/__tests__/billingEngine.test.ts`:

```typescript
import { computeEstimate } from '@/lib/services/answering-service/billingEngine'
import type { UsagePeriod } from '@/types/operator'

const PERIOD = {
  start: new Date('2026-03-01T00:00:00Z'),
  end: new Date('2026-03-31T23:59:59Z'),
}
const BIZ_CREATED = new Date('2025-11-01T00:00:00Z')

function makeUsagePeriod(overrides: Partial<UsagePeriod> = {}): UsagePeriod {
  return {
    id: 'up-1',
    businessId: 'business-1',
    operatorOrgId: 'org-1',
    periodDate: '2026-03-10',
    totalCalls: 47,
    totalMinutes: 134.5,
    callTypeBreakdown: {
      'urgent': { calls: 3, minutes: 12 },
      'general-info': { calls: 44, minutes: 122.5 },
    },
    source: 'csv_upload',
    status: 'processed',
    errorDetail: null,
    rawFileUrl: null,
    processedAt: '2026-03-10T10:00:00Z',
    createdAt: '2026-03-10T09:00:00Z',
    ...overrides,
  }
}

describe('computeEstimate', () => {
  it('per_call rule: counts total calls across all periods', () => {
    const periods = [
      makeUsagePeriod({ periodDate: '2026-03-10', totalCalls: 30, totalMinutes: 90 }),
      makeUsagePeriod({ periodDate: '2026-03-11', totalCalls: 17, totalMinutes: 51 }),
    ]
    const result = computeEstimate('business-1', periods, [
      { id: 'r1', businessId: 'business-1', type: 'per_call', name: 'Per Call', amount: 350, active: true },
    ], PERIOD, BIZ_CREATED)
    expect(result.totalCents).toBe(47 * 350)
    expect(result.callCount).toBe(47)
  })

  it('per_call with callTypeFilter: sums only matching breakdown calls', () => {
    const period = makeUsagePeriod({
      totalCalls: 47,
      callTypeBreakdown: { 'urgent': { calls: 3, minutes: 12 }, 'general-info': { calls: 44, minutes: 122.5 } },
    })
    const result = computeEstimate('business-1', [period], [
      { id: 'r1', businessId: 'business-1', type: 'per_call', name: 'Urgent', amount: 500, active: true, callTypeFilter: ['urgent'] },
    ], PERIOD, BIZ_CREATED)
    expect(result.lineItems[0].subtotalCents).toBe(3 * 500)
  })

  it('bucket rule: uses totalMinutes from usage periods', () => {
    const period = makeUsagePeriod({ totalMinutes: 123 })
    const result = computeEstimate('business-1', [period], [
      { id: 'r1', businessId: 'business-1', type: 'bucket', name: 'Bucket', amount: 0, active: true, includedMinutes: 100, overageRate: 5 },
    ], PERIOD, BIZ_CREATED)
    expect(result.lineItems[0].subtotalCents).toBe(23 * 5)
  })

  it('flat_monthly is unchanged', () => {
    const result = computeEstimate('business-1', [], [
      { id: 'r1', businessId: 'business-1', type: 'flat_monthly', name: 'Monthly', amount: 5900, active: true },
    ], PERIOD, BIZ_CREATED)
    expect(result.totalCents).toBe(5900)
  })

  it('setup_fee: only in first period', () => {
    const result = computeEstimate('business-1', [], [
      { id: 'r1', businessId: 'business-1', type: 'setup_fee', name: 'Setup', amount: 9900, active: true },
    ], PERIOD, new Date('2026-03-05T00:00:00Z'))
    expect(result.totalCents).toBe(9900)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx jest lib/services/answering-service/__tests__/billingEngine.test.ts --no-coverage
```

Expected: FAIL — `computeEstimate is not a function`

- [ ] **Step 3: Add `computeEstimate` to `billingEngine.ts`**

Add after `calculateInvoice`. Keep all existing exports untouched.

```typescript
import type { UsagePeriod } from '@/types/operator'

interface AggregatedUsage {
  totalCalls: number
  totalMinutes: number
  byType: Record<string, { calls: number; minutes: number }>
}

function aggregateUsagePeriods(periods: UsagePeriod[]): AggregatedUsage {
  const byType: Record<string, { calls: number; minutes: number }> = {}
  let totalCalls = 0
  let totalMinutes = 0

  for (const period of periods) {
    totalCalls += period.totalCalls
    totalMinutes += Number(period.totalMinutes)
    for (const [type, data] of Object.entries(period.callTypeBreakdown)) {
      if (!byType[type]) byType[type] = { calls: 0, minutes: 0 }
      byType[type].calls += data.calls
      byType[type].minutes += data.minutes
    }
  }
  return { totalCalls, totalMinutes, byType }
}

function applyPerCallFromUsage(rule: BillingRule, usage: AggregatedUsage): BillingLineItem {
  const count = rule.callTypeFilter
    ? rule.callTypeFilter.reduce((sum, t) => sum + (usage.byType[t]?.calls ?? 0), 0)
    : usage.totalCalls
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    unitDescription: `${count} call${count === 1 ? '' : 's'} × ${formatCurrency(rule.amount)}`,
    subtotalCents: count * rule.amount,
  }
}

function applyPerMinuteFromUsage(rule: BillingRule, usage: AggregatedUsage): BillingLineItem {
  const minutes = rule.callTypeFilter
    ? rule.callTypeFilter.reduce((sum, t) => sum + (usage.byType[t]?.minutes ?? 0), 0)
    : usage.totalMinutes
  const roundedMinutes = Math.ceil(minutes)
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    unitDescription: `${roundedMinutes} min × ${formatCurrency(rule.amount)}/min`,
    subtotalCents: roundedMinutes * rule.amount,
  }
}

function applyBucketFromUsage(rule: BillingRule, usage: AggregatedUsage): BillingLineItem {
  const minutes = rule.callTypeFilter
    ? rule.callTypeFilter.reduce((sum, t) => sum + (usage.byType[t]?.minutes ?? 0), 0)
    : usage.totalMinutes
  const roundedMinutes = Math.ceil(minutes)
  const includedMinutes = rule.includedMinutes ?? 0
  const overageRate = rule.overageRate ?? 0
  const overageMinutes = Math.max(0, roundedMinutes - includedMinutes)
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    unitDescription:
      overageMinutes === 0
        ? `${roundedMinutes} of ${includedMinutes} min included (no overage)`
        : `${includedMinutes} min included + ${overageMinutes} overage × ${formatCurrency(overageRate)}/min`,
    subtotalCents: overageMinutes * overageRate,
  }
}

export function computeEstimate(
  businessId: string,
  usagePeriods: UsagePeriod[],
  billingRules: BillingRule[],
  period: { start: Date; end: Date },
  businessCreatedAt: Date
): BillingEstimate {
  const usage = aggregateUsagePeriods(usagePeriods)
  const lineItems: BillingLineItem[] = []

  for (const rule of billingRules.filter((r) => r.active)) {
    switch (rule.type) {
      case 'per_call':
        lineItems.push(applyPerCallFromUsage(rule, usage))
        break
      case 'per_minute':
        lineItems.push(applyPerMinuteFromUsage(rule, usage))
        break
      case 'flat_monthly':
        lineItems.push(applyFlatMonthly(rule))
        break
      case 'setup_fee': {
        const item = applySetupFee(rule, businessCreatedAt, period.start)
        if (item) lineItems.push(item)
        break
      }
      case 'bucket':
        lineItems.push(applyBucketFromUsage(rule, usage))
        break
    }
  }

  return {
    businessId,
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    asOf: new Date().toISOString(),
    totalCents: lineItems.reduce((sum, item) => sum + item.subtotalCents, 0),
    callCount: usage.totalCalls,
    lineItems,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest lib/services/answering-service/__tests__/billingEngine.test.ts --no-coverage
```

Expected: all tests pass (old + new)

- [ ] **Step 5: Update `billingService.getCurrentEstimate` to use `usage_periods`**

In `lib/services/answering-service/billingService.ts`, replace `getCurrentEstimate`:

```typescript
import { computeEstimate } from '@/lib/services/answering-service/billingEngine'
import type { UsagePeriod } from '@/types/operator'

interface UsagePeriodRow {
  id: string
  business_id: string
  operator_org_id: string
  period_date: string
  total_calls: number
  total_minutes: string   // NUMERIC comes back as string from Supabase
  call_type_breakdown: Record<string, { calls: number; minutes: number }>
  source: UsagePeriod['source']
  status: UsagePeriod['status']
  error_detail: UsagePeriod['errorDetail']
  raw_file_url: string | null
  processed_at: string | null
  created_at: string
}

function mapUsagePeriod(row: UsagePeriodRow): UsagePeriod {
  return {
    id: row.id,
    businessId: row.business_id,
    operatorOrgId: row.operator_org_id,
    periodDate: row.period_date,
    totalCalls: row.total_calls,
    totalMinutes: Number(row.total_minutes),
    callTypeBreakdown: row.call_type_breakdown ?? {},
    source: row.source,
    status: row.status,
    errorDetail: row.error_detail,
    rawFileUrl: row.raw_file_url,
    processedAt: row.processed_at,
    createdAt: row.created_at,
  }
}

export async function getCurrentEstimate(businessId: string): Promise<BillingEstimate> {
  const supabase = await createClient()
  const period = getCurrentPeriod()

  const [rules, usageResult, businessResult] = await Promise.all([
    getBillingRules(businessId),
    supabase
      .from('usage_periods')
      .select('id, business_id, operator_org_id, period_date, total_calls, total_minutes, call_type_breakdown, source, status, error_detail, raw_file_url, processed_at, created_at')
      .eq('business_id', businessId)
      .eq('status', 'processed')
      .gte('period_date', period.start.toISOString().slice(0, 10))
      .lte('period_date', period.end.toISOString().slice(0, 10)),
    supabase.from('businesses').select('created_at').eq('id', businessId).maybeSingle(),
  ])

  if (usageResult.error) {
    throw new Error('Failed to load usage data for billing estimate.')
  }
  if (businessResult.error) {
    throw new Error('Failed to load business billing context.')
  }

  const businessCreatedAt = new Date(
    (businessResult.data as { created_at?: string } | null)?.created_at ?? period.start.toISOString()
  )
  const usagePeriods = ((usageResult.data ?? []) as UsagePeriodRow[]).map(mapUsagePeriod)

  return computeEstimate(businessId, usagePeriods, rules, period, businessCreatedAt)
}
```

- [ ] **Step 6: Audit all callers of `calculateEstimate` and update or deprecate**

The spec says to rename/alias `calculateEstimate` to `computeEstimate` and update all callers in the same pass. Run:

```bash
grep -r 'calculateEstimate' --include='*.ts' --include='*.tsx' .
```

Expected callers: `billingService.ts` (already updated in Step 5) and potentially test files. For each remaining import of `calculateEstimate`:
- If it tests the old signature (CallLog[]-based), either update to `computeEstimate` with UsagePeriod inputs, or keep `calculateEstimate` as a named export for backward compat if `calculateInvoice` still uses it.
- `calculateBilling` is kept as-is (used by `calculateInvoice` for past invoices). `calculateEstimate` can be removed if no callers remain, or exported as a deprecated alias.

After the grep, add a `// @deprecated — use computeEstimate` JSDoc on `calculateEstimate` and confirm no other files import it.

- [ ] **Step 7: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add lib/services/answering-service/billingEngine.ts \
  lib/services/answering-service/billingService.ts \
  lib/services/answering-service/__tests__/billingEngine.test.ts
git commit -m "feat: billingEngine computeEstimate from usage_periods; update billingService"
```

---

### Task 7: Billing ingest service and API (`POST /api/v1/usage`)

> **Open question resolved:** Processing is synchronous within the same request. After inserting rows with `status='pending'`, the handler immediately validates and updates them to `'processed'` or `'error'`. No edge function or queue needed for v1.

**Files:**
- Create: `lib/services/operator/usageIngestService.ts`
- Create: `lib/services/operator/__tests__/usageIngestService.test.ts`
- Create: `app/api/v1/usage/route.ts`

- [ ] **Step 1: Write failing tests for CSV parsing and row validation**

```typescript
// lib/services/operator/__tests__/usageIngestService.test.ts
import { parseCsvRows, validateRow } from '@/lib/services/operator/usageIngestService'

describe('parseCsvRows', () => {
  it('parses a minimal row', () => {
    const csv = 'date,business_id,total_calls,total_minutes\n2026-03-10,uuid-here,47,134.5'
    const rows = parseCsvRows(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      date: '2026-03-10',
      businessId: 'uuid-here',
      totalCalls: 47,
      totalMinutes: 134.5,
      callTypeBreakdown: {},
    })
  })

  it('parses call type columns', () => {
    const csv = 'date,business_id,total_calls,total_minutes,urgent_calls,urgent_minutes\n2026-03-10,uuid-here,3,12.0,3,12.0'
    const rows = parseCsvRows(csv)
    expect(rows[0].callTypeBreakdown).toEqual({ urgent: { calls: 3, minutes: 12 } })
  })

  it('last row wins for duplicate (business_id, date) within same CSV', () => {
    const csv = [
      'date,business_id,total_calls,total_minutes',
      '2026-03-10,uuid-here,47,134.5',
      '2026-03-10,uuid-here,50,140.0',  // duplicate — wins
    ].join('\n')
    const rows = parseCsvRows(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].totalCalls).toBe(50)
  })

  it('skips blank lines', () => {
    const csv = 'date,business_id,total_calls,total_minutes\n\n2026-03-10,uuid-here,5,10\n'
    expect(parseCsvRows(csv)).toHaveLength(1)
  })
})

describe('validateRow', () => {
  it('passes a valid row', () => {
    const result = validateRow({ date: '2026-03-10', businessId: 'b-1', totalCalls: 5, totalMinutes: 10, callTypeBreakdown: {} }, ['b-1'])
    expect(result.valid).toBe(true)
  })

  it('fails on invalid date format', () => {
    const result = validateRow({ date: '03/10/2026', businessId: 'b-1', totalCalls: 5, totalMinutes: 10, callTypeBreakdown: {} }, ['b-1'])
    expect(result.valid).toBe(false)
    expect(result.issue).toMatch(/date/)
  })

  it('fails if business_id not in allowed set', () => {
    const result = validateRow({ date: '2026-03-10', businessId: 'unknown', totalCalls: 5, totalMinutes: 10, callTypeBreakdown: {} }, ['b-1'])
    expect(result.valid).toBe(false)
    expect(result.issue).toMatch(/business/)
  })

  it('fails on negative total_calls', () => {
    const result = validateRow({ date: '2026-03-10', businessId: 'b-1', totalCalls: -1, totalMinutes: 10, callTypeBreakdown: {} }, ['b-1'])
    expect(result.valid).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx jest lib/services/operator/__tests__/usageIngestService.test.ts --no-coverage
```

Expected: FAIL

- [ ] **Step 3: Implement `lib/services/operator/usageIngestService.ts`**

```typescript
// lib/services/operator/usageIngestService.ts
import { createClient } from '@/lib/supabase/server'

export interface ParsedRow {
  date: string
  businessId: string
  totalCalls: number
  totalMinutes: number
  callTypeBreakdown: Record<string, { calls: number; minutes: number }>
}

export interface ValidationResult {
  valid: boolean
  issue?: string
}

export interface IngestResult {
  businessId: string
  date: string
  status: 'processed' | 'error'
  issue?: string
}

/**
 * Parse a CSV string into structured rows.
 * Expected format:
 *   date,business_id,total_calls,total_minutes[,{calltype}_calls,{calltype}_minutes,...]
 *
 * Call type columns must be in _calls / _minutes pairs.
 * Within the same CSV, the last row for a (business_id, date) pair wins.
 */
export function parseCsvRows(csv: string): ParsedRow[] {
  const lines = csv.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map((h) => h.trim())
  const dateIdx = headers.indexOf('date')
  const bizIdx = headers.indexOf('business_id')
  const callsIdx = headers.indexOf('total_calls')
  const minutesIdx = headers.indexOf('total_minutes')

  if ([dateIdx, bizIdx, callsIdx, minutesIdx].includes(-1)) return []

  // Find call type columns: pairs of {type}_calls and {type}_minutes
  const callTypeColPairs: Array<{ type: string; callsIdx: number; minutesIdx: number }> = []
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].endsWith('_calls') && headers[i] !== 'total_calls') {
      const typeName = headers[i].slice(0, -6)  // strip "_calls"
      const minutesColIdx = headers.indexOf(`${typeName}_minutes`)
      if (minutesColIdx !== -1) {
        callTypeColPairs.push({ type: typeName, callsIdx: i, minutesIdx: minutesColIdx })
      }
    }
  }

  // Use a map to implement "last row wins" for duplicate (business_id, date)
  const seen = new Map<string, ParsedRow>()

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim())
    if (cols.length < 4) continue

    const date = cols[dateIdx]
    const businessId = cols[bizIdx]
    const totalCalls = parseInt(cols[callsIdx], 10)
    const totalMinutes = parseFloat(cols[minutesIdx])

    if (!date || !businessId || isNaN(totalCalls) || isNaN(totalMinutes)) continue

    const callTypeBreakdown: Record<string, { calls: number; minutes: number }> = {}
    for (const { type, callsIdx: cIdx, minutesIdx: mIdx } of callTypeColPairs) {
      const calls = parseInt(cols[cIdx] ?? '0', 10)
      const minutes = parseFloat(cols[mIdx] ?? '0')
      if (!isNaN(calls) && !isNaN(minutes)) {
        callTypeBreakdown[type] = { calls, minutes }
      }
    }

    const key = `${businessId}|${date}`
    seen.set(key, { date, businessId, totalCalls, totalMinutes, callTypeBreakdown })
  }

  return Array.from(seen.values())
}

export function validateRow(
  row: ParsedRow,
  allowedBusinessIds: string[]
): ValidationResult {
  // Date must be YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
    return { valid: false, issue: `Invalid date format: "${row.date}". Expected YYYY-MM-DD.` }
  }

  // Business must belong to this operator
  if (!allowedBusinessIds.includes(row.businessId)) {
    return { valid: false, issue: `business_id "${row.businessId}" does not belong to this operator org.` }
  }

  // Numeric sanity checks
  if (row.totalCalls < 0) {
    return { valid: false, issue: `total_calls must be >= 0, got ${row.totalCalls}.` }
  }
  if (row.totalMinutes < 0) {
    return { valid: false, issue: `total_minutes must be >= 0, got ${row.totalMinutes}.` }
  }

  return { valid: true }
}

/**
 * Upserts a set of ParsedRows into usage_periods for the given operator.
 * Rows that fail validation get status='error'; valid rows get status='processed'.
 * Returns per-row results for the API response.
 */
export async function ingestRows(
  rows: ParsedRow[],
  operatorOrgId: string,
  allowedBusinessIds: string[],
  source: 'csv_upload' | 'api' = 'csv_upload'
): Promise<IngestResult[]> {
  // Use service-role client — ingest pipeline bypasses RLS
  const { createClient: createServiceClient } = await import('@/lib/supabase/server')
  const supabase = await createServiceClient()

  const results: IngestResult[] = []

  for (const row of rows) {
    const validation = validateRow(row, allowedBusinessIds)

    if (!validation.valid) {
      // Insert error row
      await supabase.from('usage_periods').upsert({
        business_id: row.businessId,
        operator_org_id: operatorOrgId,
        period_date: row.date,
        total_calls: 0,
        total_minutes: 0,
        call_type_breakdown: {},
        source,
        status: 'error',
        error_detail: { issue: validation.issue },
        processed_at: null,
      }, { onConflict: 'business_id,period_date' })

      results.push({ businessId: row.businessId, date: row.date, status: 'error', issue: validation.issue })
      continue
    }

    const { error } = await supabase.from('usage_periods').upsert({
      business_id: row.businessId,
      operator_org_id: operatorOrgId,
      period_date: row.date,
      total_calls: row.totalCalls,
      total_minutes: row.totalMinutes,
      call_type_breakdown: row.callTypeBreakdown,
      source,
      status: 'processed',
      error_detail: null,
      processed_at: new Date().toISOString(),
    }, { onConflict: 'business_id,period_date' })

    if (error) {
      results.push({ businessId: row.businessId, date: row.date, status: 'error', issue: 'Database write failed.' })
    } else {
      results.push({ businessId: row.businessId, date: row.date, status: 'processed' })
    }
  }

  return results
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest lib/services/operator/__tests__/usageIngestService.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 5: Create `lib/api/bearerAuth.ts` stub**

`validateBearerToken` is referenced in the route below but fully implemented in Task 11. Create a typed stub now so the file compiles:

```typescript
// lib/api/bearerAuth.ts
// STUB — replaced with full implementation in Task 11.
export type AuthResult = { valid: true; keyId: string; businessId: string | null; operatorOrgId: string | null; scopes: string[] }
export type AuthFailure = { valid: false; status: 401 | 403; message: string }
export type BearerAuthResult = AuthResult | AuthFailure

export function hashApiKey(_rawKey: string): string { return '' }
export function generateRawApiKey(): string { return '' }
export function checkScope(_scopes: string[], _required: string): boolean { return false }
export function checkIpAllowlist(_ips: string[] | null, _ip: string): boolean { return true }

export async function validateBearerToken(
  _authHeader: string | null,
  _requiredScope: string,
  _clientIp: string
): Promise<BearerAuthResult> {
  // Stub: always rejects. Task 11 replaces this with the real hash-lookup implementation.
  return { valid: false, status: 401, message: 'Bearer auth not yet implemented.' }
}
```

- [ ] **Step 6: Create `app/api/v1/usage/route.ts`**

```typescript
// app/api/v1/usage/route.ts
//
// GET  /api/v1/usage  — Bearer auth (billing:read). For external API consumers.
// POST /api/v1/usage  — Hybrid auth: Bearer (usage:write) OR operator session (admin role).
//   The hybrid POST satisfies AD-2: the operator admin CSV upload panel posts here using
//   the session cookie, and programmatic API clients post here using a Bearer key.
//   One route, one validation layer.
import { NextRequest, NextResponse } from 'next/server'
import { validateBearerToken } from '@/lib/api/bearerAuth'
import { getOperatorContext } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'
import { parseCsvRows, ingestRows } from '@/lib/services/operator/usageIngestService'
import { logger } from '@/lib/utils/logger'
import { sanitizeErrorMessage } from '@/lib/utils/errorSanitizer'

export async function GET(request: NextRequest) {
  // Bearer auth only — this is the external API endpoint (billing:read scope)
  const auth = await validateBearerToken(
    request.headers.get('authorization'),
    'billing:read',
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '0.0.0.0'
  )
  if (!auth.valid) {
    return NextResponse.json({ error: { message: auth.message, code: 'UNAUTHORIZED' } }, { status: auth.status })
  }

  try {
    const url = new URL(request.url)
    const businessId = auth.businessId ?? url.searchParams.get('business_id')

    const supabase = await createClient()
    let query = supabase
      .from('usage_periods')
      .select('id, business_id, period_date, total_calls, total_minutes, source, status, error_detail, processed_at, created_at')
      .order('period_date', { ascending: false })
      .limit(100)

    // Scope to key owner
    if (auth.operatorOrgId) {
      query = query.eq('operator_org_id', auth.operatorOrgId)
    }
    if (businessId) {
      query = query.eq('business_id', businessId)
    } else if (auth.businessId) {
      query = query.eq('business_id', auth.businessId)
    }

    const { data, error } = await query
    if (error) throw error

    return NextResponse.json({ data })
  } catch (error) {
    logger.error('GET /api/v1/usage failed', { error })
    return NextResponse.json({ error: { message: sanitizeErrorMessage(error), code: 'INTERNAL_ERROR' } }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  // Hybrid auth: try Bearer first (usage:write), fall back to operator session (admin role).
  // Both paths lead to the same ingest logic — AD-2 "one validation layer, one code path."
  let operatorOrgId: string
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '0.0.0.0'
  const authHeader = request.headers.get('authorization')

  if (authHeader?.startsWith('Bearer ')) {
    // API consumer path — Bearer key with usage:write scope
    const auth = await validateBearerToken(authHeader, 'usage:write', clientIp)
    if (!auth.valid) {
      return NextResponse.json({ error: { message: auth.message, code: 'UNAUTHORIZED' } }, { status: auth.status })
    }
    if (!auth.operatorOrgId) {
      return NextResponse.json(
        { error: { message: 'usage:write requires an operator-scoped API key.', code: 'FORBIDDEN' } },
        { status: 403 }
      )
    }
    operatorOrgId = auth.operatorOrgId
  } else {
    // Operator admin UI path — session cookie auth
    const context = await getOperatorContext()
    if (!context) {
      return NextResponse.json({ error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } }, { status: 401 })
    }
    if (context.role !== 'admin') {
      return NextResponse.json({ error: { message: 'Forbidden: admin role required', code: 'FORBIDDEN' } }, { status: 403 })
    }
    operatorOrgId = context.operatorOrgId
  }

  try {
    const supabase = await createClient()
    const { data: businesses } = await supabase
      .from('businesses')
      .select('id')
      .eq('operator_org_id', operatorOrgId)
    const allowedIds = (businesses ?? []).map((b) => b.id as string)

    let rows
    const contentType = request.headers.get('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      if (!file) {
        return NextResponse.json({ error: { message: 'Missing file field', code: 'BAD_REQUEST' } }, { status: 400 })
      }
      const csv = await file.text()
      rows = parseCsvRows(csv)
    } else {
      const body = await request.json() as unknown
      if (!Array.isArray(body)) {
        return NextResponse.json({ error: { message: 'Body must be a JSON array', code: 'BAD_REQUEST' } }, { status: 400 })
      }
      rows = body as ReturnType<typeof parseCsvRows>
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: { message: 'No rows to process', code: 'BAD_REQUEST' } }, { status: 400 })
    }

    const results = await ingestRows(rows, operatorOrgId, allowedIds, authHeader?.startsWith('Bearer ') ? 'api' : 'csv_upload')
    const errorCount = results.filter((r) => r.status === 'error').length

    return NextResponse.json({
      data: {
        processed: results.filter((r) => r.status === 'processed').length,
        errors: errorCount,
        results,
      },
    }, { status: errorCount > 0 ? 207 : 200 })

  } catch (error) {
    logger.error('POST /api/v1/usage failed', { error })
    return NextResponse.json({ error: { message: sanitizeErrorMessage(error), code: 'INTERNAL_ERROR' } }, { status: 500 })
  }
}
```

- [ ] **Step 7: Run full test suite**

```bash
npx jest --no-coverage
```

- [ ] **Step 8: Commit**

```bash
git add lib/api/bearerAuth.ts \
  lib/services/operator/usageIngestService.ts \
  lib/services/operator/__tests__/usageIngestService.test.ts \
  app/api/v1/usage/route.ts
git commit -m "feat: billing ingest service, POST /api/v1/usage, bearerAuth stub"
```

---

### Task 8: Billing ingest UI (`/operator/usage`)

**Files:**
- Create: `components/operator/UsageUploadPanel.tsx`
- Create: `components/operator/UsageHistory.tsx`
- Modify: `app/(operator)/operator/usage/page.tsx`

- [ ] **Step 1: Create `components/operator/UsageUploadPanel.tsx`**

```tsx
// components/operator/UsageUploadPanel.tsx
'use client'

import { useState, useRef } from 'react'

interface RowResult {
  businessId: string
  date: string
  status: 'processed' | 'error'
  issue?: string
}

export function UsageUploadPanel() {
  const [results, setResults] = useState<RowResult[] | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setUploading(true)
    setError(null)
    setResults(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/v1/usage', { method: 'POST', body: formData })
      const json = await res.json() as { data?: { results: RowResult[] }; error?: { message: string } }
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? 'Upload failed.')
      } else {
        setResults(json.data.results)
      }
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div
        className="cursor-pointer rounded-lg border-2 border-dashed border-slate-200 p-8 text-center hover:border-slate-400"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const file = e.dataTransfer.files[0]
          if (file) handleFile(file)
        }}
      >
        <p className="text-sm text-slate-500">
          {uploading ? 'Processing…' : 'Drop a CSV here or click to select'}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
          }}
        />
      </div>

      <div className="rounded-md bg-slate-50 p-3 text-xs font-mono text-slate-500">
        Expected format:<br />
        date,business_id,total_calls,total_minutes[,&#123;type&#125;_calls,&#123;type&#125;_minutes,...]<br />
        2026-03-10,uuid-here,47,134.5,urgent_calls,3,urgent_minutes,12.0
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {results && (
        <ul className="space-y-1">
          {results.map((r, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span>{r.status === 'processed' ? '✓' : '✗'}</span>
              <span>{r.businessId}</span>
              <span className="text-slate-400">{r.date}</span>
              {r.issue && <span className="text-red-600">{r.issue}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `components/operator/UsageHistory.tsx`**

```tsx
// components/operator/UsageHistory.tsx
import { formatDistanceToNow } from 'date-fns'

interface UsagePeriodRow {
  id: string
  business_id: string
  period_date: string
  total_calls: number
  total_minutes: string
  source: string
  status: string
  error_detail: { issue?: string } | null
  created_at: string
}

export function UsageHistory({ rows }: { rows: UsagePeriodRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-slate-500">
          <th className="pb-2 pr-4 font-medium">Date</th>
          <th className="pb-2 pr-4 font-medium">Business</th>
          <th className="pb-2 pr-4 font-medium">Calls</th>
          <th className="pb-2 pr-4 font-medium">Minutes</th>
          <th className="pb-2 pr-4 font-medium">Status</th>
          <th className="pb-2 font-medium">Uploaded</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="border-b border-slate-100">
            <td className="py-2 pr-4 font-mono">{row.period_date}</td>
            <td className="py-2 pr-4 font-mono text-xs">{row.business_id.slice(0, 8)}…</td>
            <td className="py-2 pr-4 tabular-nums">{row.total_calls}</td>
            <td className="py-2 pr-4 tabular-nums">{Number(row.total_minutes).toFixed(1)}</td>
            <td className="py-2 pr-4">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                row.status === 'processed' ? 'bg-green-100 text-green-800'
                : row.status === 'error' ? 'bg-red-100 text-red-800'
                : 'bg-yellow-100 text-yellow-800'
              }`}>
                {row.status}
              </span>
              {row.error_detail?.issue && (
                <span className="ml-2 text-xs text-red-600">{row.error_detail.issue}</span>
              )}
            </td>
            <td className="py-2 text-slate-400">
              {formatDistanceToNow(new Date(row.created_at), { addSuffix: true })}
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={6} className="py-8 text-center text-slate-400">No uploads yet.</td>
          </tr>
        )}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 3: Wire up `app/(operator)/operator/usage/page.tsx`**

```tsx
// app/(operator)/operator/usage/page.tsx
import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'
import { UsageUploadPanel } from '@/components/operator/UsageUploadPanel'
import { UsageHistory } from '@/components/operator/UsageHistory'

export default async function UsagePage() {
  const context = await checkOperatorAccessOrThrow()
  const supabase = await createClient()

  const { data: history } = await supabase
    .from('usage_periods')
    .select('id, business_id, period_date, total_calls, total_minutes, source, status, error_detail, created_at')
    .eq('operator_org_id', context.operatorOrgId)
    .order('created_at', { ascending: false })
    .limit(30)

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Usage Ingest</h1>

      <section>
        <h2 className="mb-4 text-base font-semibold">Upload CSV</h2>
        {context.role === 'admin' ? (
          <UsageUploadPanel />
        ) : (
          <p className="text-sm text-slate-400">Admin role required to upload usage data.</p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-6 opacity-60">
        <h2 className="mb-2 text-base font-semibold text-slate-400">API Connection (coming soon)</h2>
        <p className="text-sm text-slate-400">
          Connect your billing platform directly — coming soon.
        </p>
      </section>

      <section>
        <h2 className="mb-4 text-base font-semibold">Upload History</h2>
        <UsageHistory rows={history ?? []} />
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add components/operator/UsageUploadPanel.tsx components/operator/UsageHistory.tsx \
  "app/(operator)/operator/usage/page.tsx"
git commit -m "feat: billing ingest UI with CSV upload and history table"
```

---

### Task 9: Billing usage bar on client portal + operator client detail billing tab

**Files:**
- Create: `components/operator/BillingUsageBar.tsx`
- Modify: `app/(platform)/answering-service/dashboard/AnsweringServiceDashboardClient.tsx`
- Modify: `app/(operator)/operator/clients/[id]/page.tsx` (update billing tab)

- [ ] **Step 1: Create `components/operator/BillingUsageBar.tsx`**

```tsx
// components/operator/BillingUsageBar.tsx
export function BillingUsageBar({
  percent,
  includedMinutes,
  usedMinutes,
  label = 'Usage this period',
}: {
  percent: number
  includedMinutes: number
  usedMinutes: number
  label?: string
}) {
  const capped = Math.min(percent, 100)
  const barColor =
    percent >= 100 ? 'bg-red-500'
    : percent >= 90 ? 'bg-orange-500'
    : percent >= 75 ? 'bg-yellow-500'
    : 'bg-green-500'

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500">{label}</span>
        <span className="font-medium tabular-nums">{percent}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${capped}%` }}
        />
      </div>
      <p className="text-xs text-slate-400">
        {usedMinutes.toFixed(1)} of {includedMinutes} included minutes used
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Add billing meter to client dashboard**

In `app/(platform)/answering-service/dashboard/AnsweringServiceDashboardClient.tsx`, the component already shows a `DashboardBillingCard`. We need to add the `BillingUsageBar` below it when a bucket plan is active.

The `DashboardSummary` type doesn't yet include usage data. For the client portal, we'll add a separate API call to `GET /api/v1/billing/estimate` (which will exist after Task 11). For now, add a placeholder. Full implementation happens in Task 11.

Add a comment block in `AnsweringServiceDashboardClient.tsx` where the meter will go:

```typescript
// TODO(Task 11): Add <BillingUsageBar> here once GET /api/v1/billing/estimate returns usagePeriods.
// The meter reads estimate.callCount / bucket.includedMinutes to compute percent.
```

- [ ] **Step 3: Commit**

```bash
git add components/operator/BillingUsageBar.tsx \
  app/(platform)/answering-service/dashboard/AnsweringServiceDashboardClient.tsx
git commit -m "feat: BillingUsageBar component; placeholder for client portal meter"
```

---

### Task 10: Billing threshold alerts

**Files:**
- Modify: `lib/services/operator/usageIngestService.ts` (add threshold detection)
- Create: `lib/services/operator/__tests__/thresholdAlerts.test.ts`

Threshold logic: after processing each `usage_periods` row, compute the month-to-date total minutes for the business across all processed rows. For each active `bucket` billing rule, check if any threshold (75%, 90%, 100%) was crossed by this upload (i.e., was below that threshold before, now at or above). Fire the `billing.threshold_XX` webhook and send an alert email.

> **Email delivery:** For v1, use Supabase Auth admin API to send a notification email to all `operator_users` with `role='admin'`. Log the email attempt. Actual email template is plain text.

- [ ] **Step 1: Write threshold detection tests**

```typescript
// lib/services/operator/__tests__/thresholdAlerts.test.ts
import { checkBillingThresholds } from '@/lib/services/operator/usageIngestService'

describe('checkBillingThresholds', () => {
  it('detects crossing 75% threshold', () => {
    const crossed = checkBillingThresholds({
      previousMinutes: 70,
      newMinutes: 80,
      includedMinutes: 100,
    })
    expect(crossed).toEqual([75])
  })

  it('detects multiple thresholds crossed in one upload', () => {
    const crossed = checkBillingThresholds({
      previousMinutes: 60,
      newMinutes: 95,
      includedMinutes: 100,
    })
    expect(crossed).toEqual([75, 90])
  })

  it('detects 100% threshold', () => {
    const crossed = checkBillingThresholds({
      previousMinutes: 95,
      newMinutes: 102,
      includedMinutes: 100,
    })
    expect(crossed).toEqual([100])
  })

  it('returns empty if no threshold crossed', () => {
    const crossed = checkBillingThresholds({
      previousMinutes: 30,
      newMinutes: 50,
      includedMinutes: 100,
    })
    expect(crossed).toEqual([])
  })

  it('does not re-fire threshold if already above it before upload', () => {
    const crossed = checkBillingThresholds({
      previousMinutes: 85,
      newMinutes: 88,
      includedMinutes: 100,
    })
    expect(crossed).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx jest lib/services/operator/__tests__/thresholdAlerts.test.ts --no-coverage
```

- [ ] **Step 3: Create `lib/services/operator/webhookService.ts` stub**

`fireWebhookEvent` is called from the threshold alert code below, but the full webhook delivery implementation is in Task 13. Create a typed stub now so the code compiles and the no-op is obvious:

```typescript
// lib/services/operator/webhookService.ts
// STUB — replaced with full delivery implementation in Task 13.

export async function fireWebhookEvent(
  _operatorOrgId: string,
  _topic: string,
  _payload: Record<string, unknown>
): Promise<void> {
  // No-op stub. Task 13 implements subscription lookup, HMAC signing, and delivery.
}

export async function processRetryQueue(): Promise<void> {
  // No-op stub. Task 13 implements retry logic.
}
```

- [ ] **Step 4: Add `checkBillingThresholds` to `usageIngestService.ts`**

```typescript
const THRESHOLD_LEVELS = [75, 90, 100] as const

export function checkBillingThresholds(input: {
  previousMinutes: number
  newMinutes: number
  includedMinutes: number
}): number[] {
  const { previousMinutes, newMinutes, includedMinutes } = input
  const prevPct = (previousMinutes / includedMinutes) * 100
  const newPct = (newMinutes / includedMinutes) * 100

  return THRESHOLD_LEVELS.filter((level) => prevPct < level && newPct >= level)
}
```

Also add a `checkAndFireThresholdAlerts` helper that is called from `ingestRows` after a successful upsert. This function:
1. Queries the previous `total_minutes` value for this `(businessId, periodDate)` **before** the upsert (passed in as `previousRowMinutes`)
2. Queries the month-to-date total **after** the upsert
3. Derives `totalBefore = totalAfter - newRowMinutes + previousRowMinutes` — this correctly handles re-uploads where the row already existed
4. Calls `checkBillingThresholds` for each active bucket rule
5. Fires the `billing.threshold_XX` webhook topic via `fireWebhookEvent`
6. Logs threshold crossings (email stub for v1)

**Caller update in `ingestRows`:** Before each upsert, query the existing `total_minutes` value for `(businessId, row.date)`, then pass both the new value and the old value to `checkAndFireThresholdAlerts`.

```typescript
import { fireWebhookEvent } from '@/lib/services/operator/webhookService'

export async function checkAndFireThresholdAlerts(
  businessId: string,
  operatorOrgId: string,
  periodDate: string,
  newRowMinutes: number,
  previousRowMinutes: number  // 0 if this was a new row, otherwise the replaced value
): Promise<void> {
  const supabase = await createClient()
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString().slice(0, 10)
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    .toISOString().slice(0, 10)

  // Sum AFTER the upsert (includes the new row value)
  const { data: usagePeriods } = await supabase
    .from('usage_periods')
    .select('total_minutes')
    .eq('business_id', businessId)
    .eq('status', 'processed')
    .gte('period_date', monthStart)
    .lte('period_date', monthEnd)

  const totalAfter = (usagePeriods ?? []).reduce((sum, r) => sum + Number(r.total_minutes), 0)
  // Correct pre-upload total: subtract what we just wrote, add back what was there before.
  // This handles re-uploads correctly (upsert may replace an existing row, not just add new minutes).
  const totalBefore = totalAfter - newRowMinutes + previousRowMinutes

  const { data: bucketRules } = await supabase
    .from('billing_rules')
    .select('id, included_minutes')
    .eq('business_id', businessId)
    .eq('type', 'bucket')
    .eq('active', true)

  for (const rule of bucketRules ?? []) {
    if (!rule.included_minutes) continue
    const crossed = checkBillingThresholds({
      previousMinutes: totalBefore,
      newMinutes: totalAfter,
      includedMinutes: rule.included_minutes as number,
    })
    for (const level of crossed) {
      logger.info(`Billing threshold ${level}% crossed for business ${businessId}`)
      // Fire billing.threshold_XX webhook — webhookService stub created alongside this function,
      // filled in fully during Task 13 (Chunk 3).
      await fireWebhookEvent(operatorOrgId, `billing.threshold_${level}`, {
        businessId,
        thresholdPercent: level,
        totalMinutes: totalAfter,
        includedMinutes: rule.included_minutes,
      }).catch((err) => logger.error('Failed to fire threshold webhook', { err }))
      // TODO: send alert email to all operator_users with role='admin' for this org
      // Use Supabase Auth admin API: supabase.auth.admin.generateLink or a transactional
      // email provider. Query operator_users at send time — do not store on subscription.
    }
  }
}
```

**In `ingestRows`:** Before each upsert, query the existing value:
```typescript
// Before the upsert — get previous minutes if this date already exists
const { data: existingRow } = await supabase
  .from('usage_periods')
  .select('total_minutes')
  .eq('business_id', row.businessId)
  .eq('period_date', row.date)
  .maybeSingle()
const previousRowMinutes = existingRow ? Number(existingRow.total_minutes) : 0

// ... perform upsert ...

// After successful upsert:
await checkAndFireThresholdAlerts(
  row.businessId, operatorOrgId, row.date,
  row.totalMinutes, previousRowMinutes
)
```

Import `logger` from `@/lib/utils/logger`.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest lib/services/operator/__tests__/thresholdAlerts.test.ts --no-coverage
npx jest --no-coverage
```

- [ ] **Step 6: Commit**

```bash
git add lib/services/operator/webhookService.ts \
  lib/services/operator/usageIngestService.ts \
  lib/services/operator/__tests__/thresholdAlerts.test.ts
git commit -m "feat: billing threshold detection; webhookService stub"
```

---

## 🔍 Review Checkpoint 1 — After Chunk 2

Before proceeding to Chunk 3, return to Claude Code for review:

- Run `npx jest --no-coverage` — all tests must pass
- Manually test: `/operator/clients` renders with health scores, `/operator/usage` CSV upload works, billing estimate page on the client portal still loads
- Verify `grep -r 'calculateEstimate' --include='*.ts' --include='*.tsx' .` shows no unexpected callers of the old function
- Review the `bearerAuth.ts` and `webhookService.ts` stubs are in place (no real implementations yet — that's correct)
- Sign off before starting Chunk 3

---

## Chunk 3: API Surface + Webhooks + Client Key Management

### Task 11: API Bearer auth middleware

**Files:**
- Replace stub: `lib/api/bearerAuth.ts` (full implementation, replaces Task 7 stub)
- Create: `lib/api/__tests__/bearerAuth.test.ts`

The `validateBearerToken` function hashes the raw key with SHA-256, looks up `api_keys` by `key_hash`, checks `revoked_at`, `expires_at`, IP allowlist, and required scope. It also updates `last_used_at` on success.

> **Stub replacement:** Task 7 created a no-op stub at `lib/api/bearerAuth.ts`. This task replaces that file with the full implementation. The route at `app/api/v1/usage/route.ts` will now actually authenticate Bearer callers.

- [ ] **Step 1: Write failing tests**

```typescript
// lib/api/__tests__/bearerAuth.test.ts
import { hashApiKey, checkScope, checkIpAllowlist } from '@/lib/api/bearerAuth'

describe('hashApiKey', () => {
  it('produces consistent SHA-256 hash', () => {
    const hash = hashApiKey('test-key')
    expect(hash).toBe(hashApiKey('test-key'))
    expect(hash).toHaveLength(64)  // hex SHA-256 = 64 chars
    expect(hash).not.toBe('test-key')
  })
})

describe('checkScope', () => {
  it('passes when required scope is present', () => {
    expect(checkScope(['calls:read', 'billing:read'], 'calls:read')).toBe(true)
  })
  it('fails when required scope is absent', () => {
    expect(checkScope(['billing:read'], 'calls:read')).toBe(false)
  })
  it('passes for usage:write on operator key', () => {
    expect(checkScope(['usage:write', 'calls:read'], 'usage:write')).toBe(true)
  })
})

describe('checkIpAllowlist', () => {
  it('passes when allowedIps is null (unrestricted)', () => {
    expect(checkIpAllowlist(null, '1.2.3.4')).toBe(true)
  })
  it('passes when IP exactly matches', () => {
    expect(checkIpAllowlist(['192.168.1.1/32'], '192.168.1.1')).toBe(true)
  })
  it('fails when IP not in allowlist', () => {
    expect(checkIpAllowlist(['10.0.0.0/8'], '192.168.1.1')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx jest lib/api/__tests__/bearerAuth.test.ts --no-coverage
```

- [ ] **Step 3: Create `lib/api/bearerAuth.ts`**

```typescript
// lib/api/bearerAuth.ts
import { createHash } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import type { ApiKey } from '@/types/operator'

/**
 * Hash a raw API key with SHA-256. Returns a 64-char hex string.
 * Key material must be at least 32 random bytes (use generateRawApiKey).
 */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}

/**
 * Generate a cryptographically random API key.
 * 32 random bytes = 256 bits of entropy, rendered as hex (64 chars).
 * This is the only acceptable source of API key material.
 */
export function generateRawApiKey(): string {
  const { randomBytes } = require('crypto') as typeof import('crypto')
  return randomBytes(32).toString('hex')
}

export function checkScope(keyScopes: string[], requiredScope: string): boolean {
  return keyScopes.includes(requiredScope)
}

/**
 * Check if the client IP matches any CIDR in the allowlist.
 * Supports only IPv4 CIDR notation for v1. /32 = exact match.
 */
export function checkIpAllowlist(allowedIps: string[] | null, clientIp: string): boolean {
  if (!allowedIps || allowedIps.length === 0) return true

  for (const cidr of allowedIps) {
    if (ipMatchesCidr(clientIp, cidr)) return true
  }
  return false
}

function ipMatchesCidr(ip: string, cidr: string): boolean {
  const [range, prefixStr] = cidr.split('/')
  const prefix = prefixStr ? parseInt(prefixStr, 10) : 32
  const ipNum = ipToNum(ip)
  const rangeNum = ipToNum(range)
  if (ipNum === null || rangeNum === null) return false
  const mask = prefix === 0 ? 0 : ~((1 << (32 - prefix)) - 1) >>> 0
  return (ipNum & mask) === (rangeNum & mask)
}

function ipToNum(ip: string): number | null {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return null
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

export interface AuthResult {
  valid: true
  keyId: string
  businessId: string | null
  operatorOrgId: string | null
  scopes: string[]
}
export interface AuthFailure { valid: false; status: 401 | 403; message: string }
export type BearerAuthResult = AuthResult | AuthFailure

/**
 * Validate a Bearer token from the Authorization header.
 * Hashes the raw key, looks up api_keys, checks revocation, expiry, IP, and scope.
 * Updates last_used_at on success (best-effort, fire-and-forget).
 */
export async function validateBearerToken(
  authHeader: string | null,
  requiredScope: string,
  clientIp: string
): Promise<BearerAuthResult> {
  if (!authHeader?.startsWith('Bearer ')) {
    return { valid: false, status: 401, message: 'Missing or invalid Authorization header.' }
  }
  const rawKey = authHeader.slice(7).trim()
  if (!rawKey) {
    return { valid: false, status: 401, message: 'Empty API key.' }
  }

  const keyHash = hashApiKey(rawKey)
  const supabase = await createClient()

  const { data: keyRow, error } = await supabase
    .from('api_keys')
    .select('id, business_id, operator_org_id, scopes, allowed_ips, revoked_at, expires_at')
    .eq('key_hash', keyHash)
    .maybeSingle()

  if (error || !keyRow) {
    return { valid: false, status: 401, message: 'Invalid API key.' }
  }

  if (keyRow.revoked_at) {
    return { valid: false, status: 401, message: 'API key has been revoked.' }
  }
  if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
    return { valid: false, status: 401, message: 'API key has expired.' }
  }
  if (!checkIpAllowlist(keyRow.allowed_ips as string[] | null, clientIp)) {
    return { valid: false, status: 403, message: 'Request IP is not in the API key allowlist.' }
  }
  if (!checkScope(keyRow.scopes as string[], requiredScope)) {
    return { valid: false, status: 403, message: `API key missing required scope: ${requiredScope}.` }
  }

  // Update last_used_at — best-effort, do not await
  supabase
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', keyRow.id)
    .then(() => {})

  return {
    valid: true,
    keyId: keyRow.id,
    businessId: keyRow.business_id as string | null,
    operatorOrgId: keyRow.operator_org_id as string | null,
    scopes: keyRow.scopes as string[],
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest lib/api/__tests__/bearerAuth.test.ts --no-coverage
```

- [ ] **Step 5: Run full suite**

```bash
npx jest --no-coverage
```

- [ ] **Step 6: Commit**

```bash
git add lib/api/bearerAuth.ts lib/api/__tests__/bearerAuth.test.ts
git commit -m "feat: API Bearer auth middleware with hash lookup, scope, and IP checks"
```

---

### Task 12: REST API endpoints (calls, billing, webhooks)

**Files:**
- Create: `app/api/v1/calls/route.ts`
- Create: `app/api/v1/calls/[id]/route.ts`
- Create: `app/api/v1/billing/estimate/route.ts`
- Create: `app/api/v1/billing/invoices/route.ts`
- Create: `app/api/v1/webhooks/route.ts`
- Create: `app/api/v1/webhooks/[id]/route.ts`
- Create: `lib/services/operator/apiKeyService.ts`

All v1 API routes use `validateBearerToken` from `lib/api/bearerAuth.ts`. They run under service role — data scoping is enforced in application code against the key's `businessId` or `operatorOrgId`.

- [ ] **Step 1: Create `lib/services/operator/apiKeyService.ts`**

```typescript
// lib/services/operator/apiKeyService.ts
import { createClient } from '@/lib/supabase/server'
import { generateRawApiKey, hashApiKey } from '@/lib/api/bearerAuth'
import type { ApiKey } from '@/types/operator'

interface CreateKeyInput {
  label: string
  scopes: string[]
  allowedIps?: string[]
  expiresAt?: string
  businessId?: string
  operatorOrgId?: string
  createdBy: string
}

interface CreateKeyResult {
  rawKey: string   // shown to user once, then discarded
  keyId: string
}

export async function createApiKey(input: CreateKeyInput): Promise<CreateKeyResult> {
  // Enforce: usage:write scope must not be issued to a business key (AD-3)
  if (input.businessId && input.scopes.includes('usage:write')) {
    throw new Error('usage:write scope cannot be issued to a business-scoped API key.')
  }

  const rawKey = generateRawApiKey()
  const keyHash = hashApiKey(rawKey)
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      business_id: input.businessId ?? null,
      operator_org_id: input.operatorOrgId ?? null,
      key_hash: keyHash,
      label: input.label,
      scopes: input.scopes,
      allowed_ips: input.allowedIps ?? null,
      expires_at: input.expiresAt ?? null,
      created_by: input.createdBy,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error('Failed to create API key.')

  return { rawKey, keyId: data.id }
}

export async function revokeApiKey(keyId: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)

  if (error) throw new Error('Failed to revoke API key.')
}

export async function listApiKeysForBusiness(businessId: string): Promise<ApiKey[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('api_keys')
    .select('id, business_id, operator_org_id, label, scopes, allowed_ips, expires_at, last_used_at, revoked_at, created_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: false })

  if (error) throw new Error('Failed to list API keys.')

  return (data ?? []).map((k) => ({
    id: k.id,
    businessId: k.business_id as string | null,
    operatorOrgId: k.operator_org_id as string | null,
    label: k.label,
    scopes: k.scopes as string[],
    allowedIps: k.allowed_ips as string[] | null,
    expiresAt: k.expires_at as string | null,
    lastUsedAt: k.last_used_at as string | null,
    revokedAt: k.revoked_at as string | null,
    createdAt: k.created_at,
  }))
}
```

- [ ] **Step 2: Create `app/api/v1/calls/route.ts`**

```typescript
// app/api/v1/calls/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { validateBearerToken } from '@/lib/api/bearerAuth'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import { sanitizeErrorMessage } from '@/lib/utils/errorSanitizer'

export async function GET(request: NextRequest) {
  try {
    const auth = await validateBearerToken(
      request.headers.get('authorization'),
      'calls:read',
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '0.0.0.0'
    )
    if (!auth.valid) {
      return NextResponse.json({ error: { message: auth.message, code: 'UNAUTHORIZED' } }, { status: auth.status })
    }

    const url = new URL(request.url)
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
    const limit = Math.min(100, parseInt(url.searchParams.get('limit') ?? '25', 10))
    const offset = (page - 1) * limit

    const supabase = await createClient()

    // Operator key: business_id is required
    if (auth.operatorOrgId && !url.searchParams.get('business_id')) {
      return NextResponse.json(
        { error: { message: 'business_id query parameter is required for operator keys.', code: 'BAD_REQUEST' } },
        { status: 400 }
      )
    }

    const businessId = auth.businessId ?? url.searchParams.get('business_id')

    // Scope check: operator key can only query businesses in their org
    if (auth.operatorOrgId && businessId) {
      const { data: biz } = await supabase
        .from('businesses')
        .select('id')
        .eq('id', businessId)
        .eq('operator_org_id', auth.operatorOrgId)
        .maybeSingle()
      if (!biz) {
        return NextResponse.json({ error: { message: 'Business not found or not in your org.', code: 'NOT_FOUND' } }, { status: 404 })
      }
    }

    const { data, count, error } = await supabase
      .from('call_logs')
      .select('id, business_id, timestamp, call_type, direction, duration_seconds, telephony_status, message, priority, portal_status', { count: 'exact' })
      .eq('business_id', businessId!)
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) throw error

    return NextResponse.json({
      data,
      meta: { page, limit, total: count ?? 0 },
    })
  } catch (error) {
    logger.error('GET /api/v1/calls failed', { error })
    return NextResponse.json({ error: { message: sanitizeErrorMessage(error), code: 'INTERNAL_ERROR' } }, { status: 500 })
  }
}
```

- [ ] **Step 3: Create `app/api/v1/calls/[id]/route.ts`**

```typescript
// app/api/v1/calls/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { validateBearerToken } from '@/lib/api/bearerAuth'
import { createClient } from '@/lib/supabase/server'
import { sanitizeErrorMessage } from '@/lib/utils/errorSanitizer'

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await validateBearerToken(
    request.headers.get('authorization'),
    'calls:read',
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '0.0.0.0'
  )
  if (!auth.valid) {
    return NextResponse.json({ error: { message: auth.message, code: 'UNAUTHORIZED' } }, { status: auth.status })
  }

  try {
    const supabase = await createClient()
    const { data: call, error } = await supabase
      .from('call_logs')
      .select('*, message_actions(*)')
      .eq('id', params.id)
      .maybeSingle()

    if (error || !call) {
      return NextResponse.json({ error: { message: 'Call not found.', code: 'NOT_FOUND' } }, { status: 404 })
    }

    // Scope check: business key can only see its own calls
    if (auth.businessId && call.business_id !== auth.businessId) {
      return NextResponse.json({ error: { message: 'Call not found.', code: 'NOT_FOUND' } }, { status: 404 })
    }
    // Operator key: must belong to their org
    if (auth.operatorOrgId) {
      const { data: biz } = await supabase
        .from('businesses')
        .select('id')
        .eq('id', call.business_id)
        .eq('operator_org_id', auth.operatorOrgId)
        .maybeSingle()
      if (!biz) {
        return NextResponse.json({ error: { message: 'Call not found.', code: 'NOT_FOUND' } }, { status: 404 })
      }
    }

    return NextResponse.json({ data: call })
  } catch (error) {
    return NextResponse.json({ error: { message: sanitizeErrorMessage(error), code: 'INTERNAL_ERROR' } }, { status: 500 })
  }
}
```

- [ ] **Step 4: Create billing and usage endpoints**

`app/api/v1/billing/estimate/route.ts`:
```typescript
// Returns BillingEstimate for the current period using usage_periods.
// Business key: own data. Operator key: requires business_id param.
import { NextRequest, NextResponse } from 'next/server'
import { validateBearerToken } from '@/lib/api/bearerAuth'
import { getCurrentEstimate } from '@/lib/services/answering-service/billingService'
import { sanitizeErrorMessage } from '@/lib/utils/errorSanitizer'

export async function GET(request: NextRequest) {
  const auth = await validateBearerToken(
    request.headers.get('authorization'),
    'billing:read',
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '0.0.0.0'
  )
  if (!auth.valid) {
    return NextResponse.json({ error: { message: auth.message, code: 'UNAUTHORIZED' } }, { status: auth.status })
  }

  try {
    const businessId = auth.businessId ?? new URL(request.url).searchParams.get('business_id')
    if (!businessId) {
      return NextResponse.json({ error: { message: 'business_id required for operator keys', code: 'BAD_REQUEST' } }, { status: 400 })
    }
    const estimate = await getCurrentEstimate(businessId)
    return NextResponse.json({ data: estimate })
  } catch (error) {
    return NextResponse.json({ error: { message: sanitizeErrorMessage(error), code: 'INTERNAL_ERROR' } }, { status: 500 })
  }
}
```

`app/api/v1/billing/invoices/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { validateBearerToken } from '@/lib/api/bearerAuth'
import { getPastInvoices } from '@/lib/services/answering-service/billingService'
import { sanitizeErrorMessage } from '@/lib/utils/errorSanitizer'

export async function GET(request: NextRequest) {
  const auth = await validateBearerToken(
    request.headers.get('authorization'),
    'billing:read',
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '0.0.0.0'
  )
  if (!auth.valid) {
    return NextResponse.json({ error: { message: auth.message, code: 'UNAUTHORIZED' } }, { status: auth.status })
  }
  try {
    const businessId = auth.businessId ?? new URL(request.url).searchParams.get('business_id')
    if (!businessId) {
      return NextResponse.json({ error: { message: 'business_id required for operator keys', code: 'BAD_REQUEST' } }, { status: 400 })
    }
    const invoices = await getPastInvoices(businessId)
    return NextResponse.json({ data: invoices })
  } catch (error) {
    return NextResponse.json({ error: { message: sanitizeErrorMessage(error), code: 'INTERNAL_ERROR' } }, { status: 500 })
  }
}
```

- [ ] **Step 5: Create webhook subscription endpoints**

`app/api/v1/webhooks/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { validateBearerToken } from '@/lib/api/bearerAuth'
import { createClient } from '@/lib/supabase/server'
import { sanitizeErrorMessage } from '@/lib/utils/errorSanitizer'
import { randomBytes, createHmac } from 'crypto'

export async function GET(request: NextRequest) {
  const auth = await validateBearerToken(
    request.headers.get('authorization'), 'webhooks:read',
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '0.0.0.0'
  )
  if (!auth.valid) {
    return NextResponse.json({ error: { message: auth.message, code: 'UNAUTHORIZED' } }, { status: auth.status })
  }
  if (!auth.operatorOrgId) {
    return NextResponse.json({ error: { message: 'Webhooks are operator-level only.', code: 'FORBIDDEN' } }, { status: 403 })
  }

  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('webhook_subscriptions')
      // NEVER select the secret column
      .select('id, operator_org_id, url, topics, status, consecutive_failure_count, created_at, updated_at')
      .eq('operator_org_id', auth.operatorOrgId)
      .order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ data })
  } catch (error) {
    return NextResponse.json({ error: { message: sanitizeErrorMessage(error), code: 'INTERNAL_ERROR' } }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const auth = await validateBearerToken(
    request.headers.get('authorization'), 'webhooks:write',
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '0.0.0.0'
  )
  if (!auth.valid) {
    return NextResponse.json({ error: { message: auth.message, code: 'UNAUTHORIZED' } }, { status: auth.status })
  }
  if (!auth.operatorOrgId) {
    return NextResponse.json({ error: { message: 'Webhooks are operator-level only.', code: 'FORBIDDEN' } }, { status: 403 })
  }

  try {
    const body = await request.json() as { url?: string; topics?: string[] }
    if (!body.url || !Array.isArray(body.topics) || body.topics.length === 0) {
      return NextResponse.json({ error: { message: 'url and topics are required.', code: 'BAD_REQUEST' } }, { status: 400 })
    }

    // Generate HMAC signing secret — never returned after this response
    const secret = randomBytes(32).toString('hex')

    const supabase = await createClient()
    const { data, error } = await supabase
      .from('webhook_subscriptions')
      .insert({
        operator_org_id: auth.operatorOrgId,
        url: body.url,
        secret,
        topics: body.topics,
        status: 'active',
      })
      .select('id, url, topics, status, created_at')
      .single()

    if (error || !data) throw new Error('Failed to create webhook subscription.')

    // Return the secret ONCE — it will never be returned again
    return NextResponse.json({ data: { ...data, secret } }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: { message: sanitizeErrorMessage(error), code: 'INTERNAL_ERROR' } }, { status: 500 })
  }
}
```

`app/api/v1/webhooks/[id]/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { validateBearerToken } from '@/lib/api/bearerAuth'
import { createClient } from '@/lib/supabase/server'
import { sanitizeErrorMessage } from '@/lib/utils/errorSanitizer'

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await validateBearerToken(
    request.headers.get('authorization'), 'webhooks:write',
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '0.0.0.0'
  )
  if (!auth.valid) {
    return NextResponse.json({ error: { message: auth.message, code: 'UNAUTHORIZED' } }, { status: auth.status })
  }
  if (!auth.operatorOrgId) {
    return NextResponse.json({ error: { message: 'Forbidden.', code: 'FORBIDDEN' } }, { status: 403 })
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from('webhook_subscriptions')
      .delete()
      .eq('id', params.id)
      .eq('operator_org_id', auth.operatorOrgId)  // scoped to operator

    if (error) throw error
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    return NextResponse.json({ error: { message: sanitizeErrorMessage(error), code: 'INTERNAL_ERROR' } }, { status: 500 })
  }
}
```

- [ ] **Step 6: Run full test suite**

```bash
npx jest --no-coverage
```

- [ ] **Step 7: Commit**

```bash
git add lib/services/operator/apiKeyService.ts \
  app/api/v1/calls/ \
  app/api/v1/billing/ \
  app/api/v1/webhooks/
git commit -m "feat: REST API endpoints for calls, billing, and webhooks"
```

---

### Task 13: Webhook delivery with retry

**Files:**
- Replace stub: `lib/services/operator/webhookService.ts` (full implementation, replaces Task 10 stub)
- Create: `lib/services/operator/__tests__/webhookService.test.ts`

> **Stub replacement:** Task 10 created a no-op stub at `lib/services/operator/webhookService.ts`. This task replaces that file with the full implementation. The threshold alerts wired in Task 10 will now actually fire webhooks.

The `fireWebhook` function signs the payload with HMAC-SHA256, POSTs to the subscription URL with a 10s timeout, records the attempt in `webhook_deliveries`, and handles retry scheduling using exponential backoff: 1m → 2m → 4m → 8m → 16m → 32m → 60m cap, max 10 attempts. `consecutive_failure_count` increments when a delivery is dead (10 failed attempts). At 5, status transitions to `'failing'`.

- [ ] **Step 1: Write failing tests for retry schedule calculation**

```typescript
// lib/services/operator/__tests__/webhookService.test.ts
import { calculateNextRetryAt } from '@/lib/services/operator/webhookService'

describe('calculateNextRetryAt', () => {
  const base = new Date('2026-03-11T12:00:00Z')

  it('attempt 1: 1 minute', () => {
    const next = calculateNextRetryAt(1, base)
    expect(next.getTime() - base.getTime()).toBe(60_000)
  })

  it('attempt 4: 8 minutes', () => {
    const next = calculateNextRetryAt(4, base)
    expect(next.getTime() - base.getTime()).toBe(8 * 60_000)
  })

  it('attempt 7+: capped at 60 minutes', () => {
    const next7 = calculateNextRetryAt(7, base)
    expect(next7.getTime() - base.getTime()).toBe(60 * 60_000)
  })

  it('attempt 10 returns null (no more retries)', () => {
    expect(calculateNextRetryAt(10, base)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
npx jest lib/services/operator/__tests__/webhookService.test.ts --no-coverage
```

- [ ] **Step 3: Create `lib/services/operator/webhookService.ts`**

```typescript
// lib/services/operator/webhookService.ts
import { createHmac } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'

const MAX_ATTEMPTS = 10
const FAILURE_THRESHOLD = 5   // consecutive dead delivery sequences before status='failing'

/**
 * Exponential backoff schedule (minutes): 1, 2, 4, 8, 16, 32, 60, 60, 60, ...
 * Returns null when max attempts is reached (no more retries).
 */
export function calculateNextRetryAt(attemptNumber: number, from: Date = new Date()): Date | null {
  if (attemptNumber >= MAX_ATTEMPTS) return null
  const delayMinutes = Math.min(Math.pow(2, attemptNumber - 1), 60)
  return new Date(from.getTime() + delayMinutes * 60_000)
}

/**
 * Sign a webhook payload using HMAC-SHA256.
 * Returns the hex signature to include as X-Webhook-Signature: sha256=<hex>.
 */
export function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * Attempt delivery of a webhook to a single subscription.
 * Records the attempt in webhook_deliveries.
 * On success: marks delivered_at, resets consecutive_failure_count to 0.
 * On failure: schedules next retry or marks dead if max attempts reached.
 */
export async function deliverWebhook(
  subscriptionId: string,
  topic: string,
  payload: Record<string, unknown>,
  attemptNumber: number = 1
): Promise<void> {
  const supabase = await createClient()

  // Fetch subscription including secret for signing
  const { data: sub, error: subError } = await supabase
    .from('webhook_subscriptions')
    .select('id, url, secret, operator_org_id, status, consecutive_failure_count')
    .eq('id', subscriptionId)
    .single()

  if (subError || !sub || sub.status === 'paused') return

  const payloadStr = JSON.stringify(payload)
  const signature = signPayload(payloadStr, sub.secret as string)

  let responseStatus: number | null = null
  let responseBody: string | null = null
  let success = false

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    const response = await fetch(sub.url as string, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Topic': topic,
        'X-Webhook-Attempt': String(attemptNumber),
      },
      body: payloadStr,
      signal: controller.signal,
    })
    clearTimeout(timeout)

    responseStatus = response.status
    const responseText = await response.text()
    responseBody = responseText.slice(0, 2000)
    success = response.status >= 200 && response.status < 300
  } catch (err) {
    logger.warn('Webhook delivery request failed', { subscriptionId, topic, attempt: attemptNumber, err })
  }

  const nextRetryAt = success ? null : calculateNextRetryAt(attemptNumber)
  const isDead = !success && nextRetryAt === null

  // Record the delivery attempt
  await supabase.from('webhook_deliveries').insert({
    subscription_id: subscriptionId,
    topic,
    payload,
    response_status: responseStatus,
    response_body: responseBody,
    attempt_number: attemptNumber,
    next_retry_at: nextRetryAt?.toISOString() ?? null,
    delivered_at: success ? new Date().toISOString() : null,
  })

  if (success) {
    await supabase
      .from('webhook_subscriptions')
      .update({ consecutive_failure_count: 0 })
      .eq('id', subscriptionId)
  } else if (isDead) {
    const newFailureCount = (sub.consecutive_failure_count as number) + 1
    const newStatus = newFailureCount >= FAILURE_THRESHOLD ? 'failing' : sub.status
    await supabase
      .from('webhook_subscriptions')
      .update({ consecutive_failure_count: newFailureCount, status: newStatus })
      .eq('id', subscriptionId)

    if (newStatus === 'failing') {
      logger.warn('Webhook subscription transitioned to failing', { subscriptionId, newFailureCount })
      // TODO: Send alert email to operator admins (same pattern as billing threshold alerts)
    }
  }
}

/**
 * Fan out a webhook event to all active subscriptions for the given operator
 * that include the given topic. Called from ingest and call mutation handlers.
 *
 * Fire-and-forget: does not await all deliveries to avoid blocking the caller.
 */
export async function fireWebhookEvent(
  operatorOrgId: string,
  topic: string,
  payload: Record<string, unknown>
): Promise<void> {
  const supabase = await createClient()

  const { data: subscriptions } = await supabase
    .from('webhook_subscriptions')
    .select('id')
    .eq('operator_org_id', operatorOrgId)
    .eq('status', 'active')
    .contains('topics', [topic])

  for (const sub of subscriptions ?? []) {
    // Fire without await — delivery failures are handled in deliverWebhook
    deliverWebhook(sub.id, topic, payload, 1).catch((err) => {
      logger.error('Unhandled webhook delivery error', { subscriptionId: sub.id, err })
    })
  }
}

/**
 * Process the retry queue: finds webhook_deliveries due for retry and re-delivers.
 * Intended to be called by a scheduled job every 1 minute.
 */
export async function processRetryQueue(): Promise<void> {
  const supabase = await createClient()

  const { data: pending } = await supabase
    .from('webhook_deliveries')
    .select('id, subscription_id, topic, payload, attempt_number')
    .lte('next_retry_at', new Date().toISOString())
    .is('delivered_at', null)
    .limit(50)

  for (const delivery of pending ?? []) {
    await deliverWebhook(
      delivery.subscription_id,
      delivery.topic,
      delivery.payload as Record<string, unknown>,
      (delivery.attempt_number as number) + 1
    )
    // Clear next_retry_at to avoid double-processing
    await supabase
      .from('webhook_deliveries')
      .update({ next_retry_at: null })
      .eq('id', delivery.id)
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest lib/services/operator/__tests__/webhookService.test.ts --no-coverage
```

- [ ] **Step 5: Wire `fireWebhookEvent` into `usageIngestService`**

In `lib/services/operator/usageIngestService.ts`, after a successful upsert in `ingestRows`, add:

```typescript
import { fireWebhookEvent } from '@/lib/services/operator/webhookService'

// After successful row:
await fireWebhookEvent(operatorOrgId, 'usage.upload_processed', {
  businessId: row.businessId,
  date: row.date,
  totalCalls: row.totalCalls,
  totalMinutes: row.totalMinutes,
})

// After error row:
await fireWebhookEvent(operatorOrgId, 'usage.upload_failed', {
  businessId: row.businessId,
  date: row.date,
  issue: validation.issue,
})
```

Also wire the threshold topics in `checkAndFireThresholdAlerts`:
```typescript
await fireWebhookEvent(operatorOrgId, `billing.threshold_${level}`, {
  businessId,
  thresholdPercent: level,
  totalMinutes: totalAfter,
  includedMinutes: rule.included_minutes,
})
```

- [ ] **Step 6: Run full test suite**

```bash
npx jest --no-coverage
```

- [ ] **Step 7: Commit**

```bash
git add lib/services/operator/webhookService.ts \
  lib/services/operator/__tests__/webhookService.test.ts \
  lib/services/operator/usageIngestService.ts
git commit -m "feat: webhook delivery with HMAC signing and exponential backoff retry"
```

---

### Task 14: OpenAPI spec

**Files:**
- Create: `app/api/v1/openapi.json/route.ts`

The spec is a static JSON object served at `/api/v1/openapi.json`. It documents all v1 endpoints, security scheme (HTTP Bearer), and schemas. Maintained by hand for v1.

- [ ] **Step 1: Create the route**

```typescript
// app/api/v1/openapi.json/route.ts
import { NextResponse } from 'next/server'

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Answering Service Operator API',
    version: '1.0.0',
    description: 'REST API for operator and client integrations.',
  },
  servers: [{ url: '/api/v1' }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'API key issued via the operator portal. Include as: Authorization: Bearer <key>',
      },
    },
  },
  paths: {
    '/calls': {
      get: {
        summary: 'List call logs',
        operationId: 'listCalls',
        parameters: [
          { name: 'business_id', in: 'query', required: false, schema: { type: 'string', format: 'uuid' }, description: 'Required for operator keys. Filter by business.' },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 25, maximum: 100 } },
        ],
        security: [{ bearerAuth: ['calls:read'] }],
        responses: { '200': { description: 'Paginated call list' }, '400': { description: 'business_id required for operator key' }, '401': { description: 'Unauthorized' } },
      },
    },
    '/calls/{id}': {
      get: {
        summary: 'Get a single call',
        operationId: 'getCall',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        security: [{ bearerAuth: ['calls:read'] }],
        responses: { '200': { description: 'Call with message actions' }, '404': { description: 'Not found' } },
      },
    },
    '/billing/estimate': {
      get: {
        summary: 'Current period billing estimate',
        operationId: 'getBillingEstimate',
        parameters: [{ name: 'business_id', in: 'query', schema: { type: 'string', format: 'uuid' }, description: 'Required for operator keys.' }],
        security: [{ bearerAuth: ['billing:read'] }],
        responses: { '200': { description: 'BillingEstimate' } },
      },
    },
    '/billing/invoices': {
      get: {
        summary: 'Past invoices',
        operationId: 'listInvoices',
        parameters: [{ name: 'business_id', in: 'query', schema: { type: 'string', format: 'uuid' } }],
        security: [{ bearerAuth: ['billing:read'] }],
        responses: { '200': { description: 'Array of BillingInvoice' } },
      },
    },
    '/usage': {
      get: {
        summary: 'List usage periods',
        operationId: 'listUsagePeriods',
        security: [{ bearerAuth: ['billing:read'] }],
        responses: { '200': { description: 'Usage periods' } },
      },
      post: {
        summary: 'Ingest billing usage (operator key, usage:write scope)',
        operationId: 'ingestUsage',
        requestBody: {
          content: {
            'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } },
            'application/json': { schema: { type: 'array', items: { type: 'object' } } },
          },
        },
        security: [{ bearerAuth: ['usage:write'] }],
        responses: { '200': { description: 'All rows processed' }, '207': { description: 'Some rows had errors' } },
      },
    },
    '/webhooks': {
      get: {
        summary: 'List webhook subscriptions',
        operationId: 'listWebhooks',
        security: [{ bearerAuth: ['webhooks:read'] }],
        responses: { '200': { description: 'Subscription list (secret excluded)' } },
      },
      post: {
        summary: 'Create webhook subscription',
        operationId: 'createWebhook',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['url', 'topics'], properties: { url: { type: 'string', format: 'uri' }, topics: { type: 'array', items: { type: 'string' } } } },
            },
          },
        },
        security: [{ bearerAuth: ['webhooks:write'] }],
        responses: { '201': { description: 'Subscription created — secret returned once' } },
      },
    },
    '/webhooks/{id}': {
      delete: {
        summary: 'Delete webhook subscription',
        operationId: 'deleteWebhook',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        security: [{ bearerAuth: ['webhooks:write'] }],
        responses: { '204': { description: 'Deleted' } },
      },
    },
  },
}

export async function GET() {
  return NextResponse.json(spec, {
    headers: { 'Content-Type': 'application/json' },
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/api/v1/openapi.json/"
git commit -m "feat: OpenAPI 3.1 spec at /api/v1/openapi.json"
```

---

### Task 15: Operator webhook and API key management UI + client-facing API key management

**Files:**
- Create: `components/operator/ApiKeyManager.tsx`
- Create: `components/operator/WebhookManager.tsx`
- Modify: `app/(operator)/operator/api-webhooks/page.tsx`
- Modify: `app/(operator)/operator/settings/page.tsx`

- [ ] **Step 1: Create `components/operator/ApiKeyManager.tsx`**

```tsx
// components/operator/ApiKeyManager.tsx
'use client'

import { useState } from 'react'

interface Key {
  id: string
  label: string
  scopes: string[]
  createdAt: string
  revokedAt: string | null
}

export function ApiKeyManager({
  keys,
  onCreateKey,
  onRevokeKey,
  isAdmin,
}: {
  keys: Key[]
  onCreateKey: (label: string, scopes: string[]) => Promise<{ rawKey: string } | { error: string }>
  onRevokeKey: (id: string) => Promise<void>
  isAdmin: boolean
}) {
  const [newLabel, setNewLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const activeKeys = keys.filter((k) => !k.revokedAt)

  async function handleCreate() {
    if (!newLabel.trim()) return
    setCreating(true)
    setError(null)
    const result = await onCreateKey(newLabel, ['calls:read', 'billing:read'])
    setCreating(false)
    if ('error' in result) {
      setError(result.error)
    } else {
      setCreatedKey(result.rawKey)
      setNewLabel('')
    }
  }

  return (
    <div className="space-y-4">
      {createdKey && (
        <div className="rounded-md border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-800">API key created — save it now, it won&apos;t be shown again.</p>
          <code className="mt-2 block break-all rounded bg-white px-3 py-2 text-xs">{createdKey}</code>
          <button
            onClick={() => setCreatedKey(null)}
            className="mt-2 text-xs text-green-700 hover:underline"
          >
            I&apos;ve saved it
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {isAdmin && (
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Key label"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newLabel.trim()}
            className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create key'}
          </button>
        </div>
      )}

      <ul className="space-y-2">
        {activeKeys.map((key) => (
          <li key={key.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm">
            <div>
              <span className="font-medium">{key.label}</span>
              <span className="ml-2 text-xs text-slate-400">{key.scopes.join(', ')}</span>
            </div>
            {isAdmin && (
              <button
                onClick={() => onRevokeKey(key.id)}
                className="text-xs text-red-600 hover:underline"
              >
                Revoke
              </button>
            )}
          </li>
        ))}
        {activeKeys.length === 0 && <p className="text-sm text-slate-400">No active API keys.</p>}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Create `components/operator/WebhookManager.tsx`**

```tsx
// components/operator/WebhookManager.tsx
'use client'

import { useState } from 'react'

const AVAILABLE_TOPICS = [
  'call.created', 'call.priority_changed', 'call.status_changed',
  'billing.threshold_75', 'billing.threshold_90', 'billing.threshold_100',
  'usage.upload_processed', 'usage.upload_failed',
]

interface Subscription {
  id: string
  url: string
  topics: string[]
  status: string
  consecutiveFailureCount: number
}

export function WebhookManager({
  subscriptions,
  onCreateSub,
  onDeleteSub,
  isAdmin,
}: {
  subscriptions: Subscription[]
  onCreateSub: (url: string, topics: string[]) => Promise<{ id: string; secret: string } | { error: string }>
  onDeleteSub: (id: string) => Promise<void>
  isAdmin: boolean
}) {
  const [url, setUrl] = useState('')
  const [selectedTopics, setSelectedTopics] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [createdSecret, setCreatedSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate() {
    if (!url.trim() || selectedTopics.length === 0) return
    setCreating(true)
    setError(null)
    const result = await onCreateSub(url, selectedTopics)
    setCreating(false)
    if ('error' in result) {
      setError(result.error)
    } else {
      setCreatedSecret(result.secret)
      setUrl('')
      setSelectedTopics([])
    }
  }

  return (
    <div className="space-y-4">
      {createdSecret && (
        <div className="rounded-md border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-800">Subscription created. Signing secret (shown once):</p>
          <code className="mt-2 block break-all rounded bg-white px-3 py-2 text-xs">{createdSecret}</code>
          <button onClick={() => setCreatedSecret(null)} className="mt-2 text-xs text-green-700 hover:underline">
            I&apos;ve saved it
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {isAdmin && (
        <div className="space-y-2 rounded-md border border-slate-200 p-4">
          <input
            type="url"
            placeholder="https://your-endpoint.example.com/webhook"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full rounded-md border border-slate-200 px-3 py-1.5 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            {AVAILABLE_TOPICS.map((topic) => (
              <label key={topic} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={selectedTopics.includes(topic)}
                  onChange={(e) => setSelectedTopics((prev) =>
                    e.target.checked ? [...prev, topic] : prev.filter((t) => t !== topic)
                  )}
                />
                {topic}
              </label>
            ))}
          </div>
          <button
            onClick={handleCreate}
            disabled={creating || !url.trim() || selectedTopics.length === 0}
            className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create subscription'}
          </button>
        </div>
      )}

      <ul className="space-y-2">
        {subscriptions.map((sub) => (
          <li key={sub.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="break-all font-mono text-xs">{sub.url}</span>
              <div className="ml-4 flex items-center gap-3 shrink-0">
                <span className={`rounded-full px-2 py-0.5 text-xs ${
                  sub.status === 'active' ? 'bg-green-100 text-green-800'
                  : sub.status === 'failing' ? 'bg-red-100 text-red-800'
                  : 'bg-yellow-100 text-yellow-800'
                }`}>{sub.status}</span>
                {isAdmin && (
                  <button onClick={() => onDeleteSub(sub.id)} className="text-xs text-red-600 hover:underline">
                    Delete
                  </button>
                )}
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-400">{sub.topics.join(', ')}</p>
          </li>
        ))}
        {subscriptions.length === 0 && <p className="text-sm text-slate-400">No subscriptions.</p>}
      </ul>
    </div>
  )
}
```

- [ ] **Step 3: Create `app/(operator)/operator/api-webhooks/actions.ts`** (Server Actions for write operations)

```typescript
// app/(operator)/operator/api-webhooks/actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { getOperatorContext } from '@/lib/auth/server'
import { createApiKey, revokeApiKey } from '@/lib/services/operator/apiKeyService'
import { createClient } from '@/lib/supabase/server'
import { randomBytes } from 'crypto'

export async function createOperatorApiKeyAction(label: string, scopes: string[]) {
  const context = await getOperatorContext()
  if (!context || context.role !== 'admin') throw new Error('Forbidden')
  return createApiKey({ label, scopes, operatorOrgId: context.operatorOrgId, createdBy: context.userId })
}

export async function revokeOperatorApiKeyAction(keyId: string) {
  const context = await getOperatorContext()
  if (!context || context.role !== 'admin') throw new Error('Forbidden')
  await revokeApiKey(keyId)
  revalidatePath('/operator/api-webhooks')
}

export async function createWebhookSubscriptionAction(url: string, topics: string[]) {
  const context = await getOperatorContext()
  if (!context || context.role !== 'admin') throw new Error('Forbidden')
  const secret = randomBytes(32).toString('hex')
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('webhook_subscriptions')
    .insert({ operator_org_id: context.operatorOrgId, url, secret, topics, status: 'active' })
    .select('id, url, topics, status, created_at')
    .single()
  if (error || !data) throw new Error('Failed to create webhook subscription.')
  revalidatePath('/operator/api-webhooks')
  return { ...data, secret }  // secret returned once here, never again
}

export async function deleteWebhookSubscriptionAction(subscriptionId: string) {
  const context = await getOperatorContext()
  if (!context || context.role !== 'admin') throw new Error('Forbidden')
  const supabase = await createClient()
  await supabase.from('webhook_subscriptions')
    .delete()
    .eq('id', subscriptionId)
    .eq('operator_org_id', context.operatorOrgId)
  revalidatePath('/operator/api-webhooks')
}
```

- [ ] **Step 4: Wire up `app/(operator)/operator/api-webhooks/page.tsx`**

The page is a **Server Component** — data is fetched directly from the DB, not via the Bearer-only `/api/v1/webhooks` endpoint. `ApiKeyManager` and `WebhookManager` receive Server Actions as callbacks.

```tsx
// app/(operator)/operator/api-webhooks/page.tsx
import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'
import { listApiKeysForBusiness } from '@/lib/services/operator/apiKeyService'
import { ApiKeyManager } from '@/components/operator/ApiKeyManager'
import { WebhookManager } from '@/components/operator/WebhookManager'
import {
  createOperatorApiKeyAction,
  revokeOperatorApiKeyAction,
  createWebhookSubscriptionAction,
  deleteWebhookSubscriptionAction,
} from './actions'

export default async function ApiWebhooksPage() {
  const context = await checkOperatorAccessOrThrow()
  const supabase = await createClient()

  // Fetch operator-scoped API keys directly from DB (not via Bearer API)
  const { data: rawKeys } = await supabase
    .from('api_keys')
    .select('id, label, scopes, created_at, revoked_at')
    .eq('operator_org_id', context.operatorOrgId)
    .order('created_at', { ascending: false })

  // Fetch webhook subscriptions directly from DB — never select the secret column
  const { data: subscriptions } = await supabase
    .from('webhook_subscriptions')
    .select('id, url, topics, status, consecutive_failure_count, created_at')
    .eq('operator_org_id', context.operatorOrgId)
    .order('created_at', { ascending: false })

  const keys = (rawKeys ?? []).map((k) => ({
    id: k.id,
    label: k.label,
    scopes: k.scopes as string[],
    createdAt: k.created_at,
    revokedAt: k.revoked_at as string | null,
  }))

  const subs = (subscriptions ?? []).map((s) => ({
    id: s.id,
    url: s.url,
    topics: s.topics as string[],
    status: s.status as 'active' | 'paused' | 'failing',
    consecutiveFailureCount: s.consecutive_failure_count,
  }))

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">API & Webhooks</h1>
      <section>
        <h2 className="mb-4 text-base font-semibold">API Keys</h2>
        <ApiKeyManager
          keys={keys}
          onCreateKey={createOperatorApiKeyAction}
          onRevokeKey={revokeOperatorApiKeyAction}
          isAdmin={context.role === 'admin'}
        />
      </section>
      <section>
        <h2 className="mb-4 text-base font-semibold">Webhook Subscriptions</h2>
        <WebhookManager
          subscriptions={subs}
          onCreateSub={createWebhookSubscriptionAction}
          onDeleteSub={deleteWebhookSubscriptionAction}
          isAdmin={context.role === 'admin'}
        />
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Wire up `app/(operator)/operator/settings/page.tsx`**

```tsx
// app/(operator)/operator/settings/page.tsx
import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'

export default async function SettingsPage() {
  const context = await checkOperatorAccessOrThrow()
  const supabase = await createClient()

  const [{ data: org }, { data: templates }] = await Promise.all([
    supabase.from('operator_orgs').select('id, name, slug, branding, settings').eq('id', context.operatorOrgId).single(),
    supabase.from('billing_rule_templates').select('id, name, description, rules, created_at').eq('operator_org_id', context.operatorOrgId).order('name'),
  ])

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section>
        <h2 className="mb-2 text-base font-semibold">Organization</h2>
        <dl className="text-sm">
          <dt className="text-slate-500">Name</dt>
          <dd>{org?.name}</dd>
          <dt className="mt-2 text-slate-500">Slug</dt>
          <dd className="font-mono">{org?.slug}</dd>
        </dl>
      </section>

      <section>
        <h2 className="mb-4 text-base font-semibold">Billing Rule Templates</h2>
        {(templates ?? []).length === 0 ? (
          <p className="text-sm text-slate-400">No templates defined. Contact support to create templates.</p>
        ) : (
          <ul className="space-y-2">
            {(templates ?? []).map((t) => (
              <li key={t.id} className="rounded-md border border-slate-200 px-3 py-2">
                <p className="font-medium">{t.name}</p>
                {t.description && <p className="text-sm text-slate-500">{t.description}</p>}
                <p className="mt-1 text-xs text-slate-400">
                  {(t.rules as unknown[]).length} rule{(t.rules as unknown[]).length !== 1 ? 's' : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="text-sm text-slate-400">
        <p>White-label branding configuration (logo, colors, domain) is managed via service role. Contact your platform administrator.</p>
      </section>
    </div>
  )
}
```

- [ ] **Step 5: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass

- [ ] **Step 6: Final integration smoke test checklist**

Manual tests (run against a development Supabase instance with seed data):

- [ ] `/operator/clients` loads and shows health scores
- [ ] `/operator/clients/[id]` loads all four tabs
- [ ] `/operator/usage` — upload a CSV and see processed rows
- [ ] `GET /api/v1/calls` with a Bearer key returns paginated call logs
- [ ] `POST /api/v1/usage` with a Bearer key + `usage:write` scope processes rows
- [ ] `POST /api/v1/webhooks` creates a subscription and returns the secret once
- [ ] `DELETE /api/v1/webhooks/:id` deletes the subscription
- [ ] `GET /api/v1/openapi.json` returns a valid JSON document
- [ ] `GET /api/v1/usage` with a Bearer key + `billing:read` scope returns usage periods
- [ ] `GET /api/v1/billing/estimate` returns an estimate sourced from `usage_periods`
- [ ] Billing estimate on existing client portal (`/answering-service/billing`) still works
- [ ] `/operator/api-webhooks` loads subscription list without Bearer token (server component fetches directly)
- [ ] Creating a webhook subscription via the page shows the secret once, then it's gone
- [ ] `/answering-service/settings` (client portal) shows API keys for that business

- [ ] **Step 7: Commit**

```bash
git add components/operator/ApiKeyManager.tsx \
  components/operator/WebhookManager.tsx \
  "app/(operator)/operator/api-webhooks/actions.ts" \
  "app/(operator)/operator/api-webhooks/page.tsx" \
  "app/(operator)/operator/settings/page.tsx"
git commit -m "feat: operator API key and webhook management UI with server actions"
```

---

### Task 16: Client-facing API key management (client portal Settings tab)

Spec: "Business members manage their own keys in the client portal (Settings tab → API Keys)."

**Files:**
- Create: `app/(platform)/answering-service/settings/page.tsx`
- Create: `app/(platform)/answering-service/settings/actions.ts`
- Note: both navs already include the Settings link — no nav changes needed

- [ ] **Step 1: Create `app/(platform)/answering-service/settings/actions.ts`**

```typescript
// app/(platform)/answering-service/settings/actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { getBusinessContext } from '@/lib/auth/server'
import { createApiKey, revokeApiKey } from '@/lib/services/operator/apiKeyService'

export async function createBusinessApiKeyAction(label: string) {
  const context = await getBusinessContext()
  if (!context) throw new Error('Unauthorized')
  // Business keys get calls:read and billing:read — never usage:write (AD-3)
  return createApiKey({
    label,
    scopes: ['calls:read', 'billing:read'],
    businessId: context.businessId,
    createdBy: context.userId,
  })
}

export async function revokeBusinessApiKeyAction(keyId: string) {
  const context = await getBusinessContext()
  if (!context) throw new Error('Unauthorized')
  // Safety: ensure the key belongs to this business before revoking
  const supabase = await (await import('@/lib/supabase/server')).createClient()
  const { data: key } = await supabase
    .from('api_keys')
    .select('id')
    .eq('id', keyId)
    .eq('business_id', context.businessId)
    .maybeSingle()
  if (!key) throw new Error('Key not found or does not belong to this business.')
  await revokeApiKey(keyId)
  revalidatePath('/answering-service/settings')
}
```

- [ ] **Step 2: Create `app/(platform)/answering-service/settings/page.tsx`**

```tsx
// app/(platform)/answering-service/settings/page.tsx
import { getBusinessContext } from '@/lib/auth/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ApiKeyManager } from '@/components/operator/ApiKeyManager'
import { createBusinessApiKeyAction, revokeBusinessApiKeyAction } from './actions'

export default async function SettingsPage() {
  const context = await getBusinessContext()
  if (!context) redirect('/login')

  const supabase = await createClient()
  const { data: rawKeys } = await supabase
    .from('api_keys')
    .select('id, label, scopes, created_at, revoked_at')
    .eq('business_id', context.businessId)
    .order('created_at', { ascending: false })

  const keys = (rawKeys ?? []).map((k) => ({
    id: k.id,
    label: k.label,
    scopes: k.scopes as string[],
    createdAt: k.created_at,
    revokedAt: k.revoked_at as string | null,
  }))

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <section>
        <h2 className="mb-2 text-base font-semibold">API Keys</h2>
        <p className="mb-4 text-sm text-slate-500">
          Use API keys to connect your systems to the portal. Keys have read-only access
          to calls and billing data. Keep them secret — lost keys must be revoked and regenerated.
        </p>
        <ApiKeyManager
          keys={keys}
          onCreateKey={async (label) => createBusinessApiKeyAction(label)}
          onRevokeKey={revokeBusinessApiKeyAction}
          isAdmin={true}
        />
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Verify nav links are already present**

Both `components/answering-service/SideNav.tsx` and `components/answering-service/BottomNav.tsx` already include `{ href: '/answering-service/settings', label: 'Settings', icon: Gear }` in their `ITEMS` arrays (line 24 in each file). No changes needed — creating the page at `app/(platform)/answering-service/settings/page.tsx` is sufficient for the link to work.

- [ ] **Step 4: Run tests**

```bash
npx jest --no-coverage
```

- [ ] **Step 5: Commit**

```bash
git add "app/(platform)/answering-service/settings/"
git commit -m "feat: client portal Settings tab with business API key management"
```

---

## 🔍 Review Checkpoint 2 — Full Feature Complete

Return to Claude Code before declaring the feature done:

- Run `npx jest --no-coverage` — full suite must pass
- Manually run the complete smoke test checklist in Task 15 Step 6
- Verify the stub files have been fully replaced: `lib/api/bearerAuth.ts` (Task 11) and `lib/services/operator/webhookService.ts` (Task 13) — neither should contain no-op stubs any more
- Check `git log --oneline` — expect ~16 focused commits, one per task
- Spot-check: `GET /api/v1/usage` rejects a session-only request with 401, accepts a Bearer `billing:read` key; `POST /api/v1/usage` accepts both Bearer and session
- Review the client portal `/answering-service/settings` page in a browser — confirm the API key create/revoke flow works end to end

---

## Implementation Notes

### Migrations
All five migrations (`20260311100000` through `20260311100400`) are already written and in `migrations/`. Apply them to your Supabase project before starting implementation:
```bash
supabase db push
```

### Seed data for development
To test the operator UI, you need at least one `operator_orgs` row and one `operator_users` row linking your dev user. Create these via the Supabase studio (service role, since INSERT is restricted to service role). Example:
```sql
INSERT INTO operator_orgs (name, slug) VALUES ('Dev Operator', 'dev-operator');
INSERT INTO operator_users (operator_org_id, user_id, role)
  VALUES ('<org-id>', '<your-auth-uid>', 'admin');
UPDATE businesses SET operator_org_id = '<org-id>' WHERE id = '<your-test-business-id>';
```

### API key creation in the operator UI
The operator-side API key management is fully wired in Task 15 via Server Actions in `app/(operator)/operator/api-webhooks/actions.ts`.

### Webhook retry processing
`processRetryQueue` in `webhookService.ts` needs a caller. For v1, add a Supabase Edge Function or a cron-triggered Next.js route at `app/api/internal/webhook-retry/route.ts` protected by a shared secret env var. Call it every minute via Supabase cron.
