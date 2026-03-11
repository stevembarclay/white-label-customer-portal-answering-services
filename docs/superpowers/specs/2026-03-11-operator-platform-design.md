# Operator Platform Design

**Date:** 2026-03-11
**Status:** Approved
**Approach:** A — Control Plane First

---

## Problem

The portal today has no operator layer. Operators deploy it and fly blind: no visibility into which clients have logged in, which are at churn risk, or which have billing problems brewing. Clients have no visibility into billing mid-period, so billing surprises are the industry's single most-complained-about issue. There is no API surface, so operators with a dev team cannot build last-mile integrations (CRM, EHR, legal software) without forking the codebase.

---

## Goals

1. **Operator admin** — operators can see all their clients at a glance, identify at-risk clients before they churn, and take action without leaving the portal.
2. **Billing transparency** — clients see a real-time usage meter on their dashboard. No more surprise invoices.
3. **Open API surface** — a dev with a day or two can connect the portal to any downstream system. Webhooks for real-time push. REST for pull.

---

## Out of Scope (this iteration)

- Direct API connections to telephony billing platforms (Amtelco, StarTel TBS) — the "grayed-out panel" placeholder ships but the connection itself is future work
- Per-client webhook subscriptions (all subscriptions are org-level)
- EHR integrations
- Operator-initiated script changes / live script editor
- On-call scheduling

---

## Multi-Tenant Hierarchy

```
Operator Org
  └── Businesses (clients)
        └── Users (business members)
```

Previously flat (`users → businesses`). The operator layer is additive — existing business and user relationships are unchanged.

---

## Architecture Decisions

### AD-1: `usage_periods` is the single source of truth for the billing meter

`billingEngine.ts` currently computes estimates from `call_logs` directly. After this feature ships, the billing meter reads from `usage_periods` exclusively. Operators using a real telephony adapter write to `usage_periods` via the ingest API; operators using CSV upload do the same. `call_logs` remains the source of truth for the messages/transcript view only.

**Why:** Two billing sources produce inconsistent numbers across operator types and create permanent support debt. Deciding now avoids a painful consolidation migration later.

### AD-2: The UI upload and API ingest are the same route

`POST /api/v1/usage` is the single ingest endpoint. The operator admin CSV upload posts to this same route. One validation layer, one error format, one code path. The "direct API connection" upgrade path is just automating what the UI already does — no new infrastructure required.

### AD-3: API keys are owner-scoped

A key issued to a **business** can only read that business's data. A key issued to an **operator org** can read across all their clients and has `usage:write` scope for the ingest endpoint. Exactly one owner is enforced at the DB level.

### AD-4: Webhook secrets are write-only

The HMAC signing secret is stored in `webhook_subscriptions.secret` and never returned by any API response after creation. If lost, the subscription must be deleted and recreated. This is standard practice (Stripe, GitHub) and prevents secret leakage via API enumeration.

---

## Data Model

Five new migrations (run after `20260310100500`):

### `20260311100000` — Operator platform foundation

**`operator_orgs`**
```
id, name, slug (unique), plan (trial|pro|enterprise), status (active|suspended|cancelled),
branding JSONB, settings JSONB, created_at, updated_at
```
- `branding`: white-label config — `logo_url`, `primary_color`, `secondary_color`, `custom_domain`
- `settings`: operator defaults — `alert_thresholds`, `default_timezone`, `notification_prefs`

**`operator_users`**
```
id, operator_org_id FK, user_id FK (auth.users), role (admin|viewer), created_at
UNIQUE (operator_org_id, user_id)
```

**`businesses` additions**
```
operator_org_id FK (nullable, SET NULL on operator delete)
churned_at TIMESTAMPTZ
health_score_override SMALLINT (0–100, nullable)
```

RLS: `operator_users_select` — users see their own rows. `businesses_operator_select` — operators see all businesses where `operator_org_id` matches their org.

---

### `20260311100100` — Usage periods

**`usage_periods`**
```
id, business_id FK, operator_org_id FK,
period_date DATE,
total_calls INT, total_minutes NUMERIC(10,2),
call_type_breakdown JSONB,   -- { "urgent": { calls: 3, minutes: 12.5 }, ... }
source (csv_upload|api),
status (pending|processed|error),
error_detail JSONB,          -- { row: 14, issue: "unknown call_type" }
raw_file_url TEXT,           -- original uploaded file in Supabase Storage
processed_at TIMESTAMPTZ, created_at
UNIQUE (business_id, period_date)
```

RLS: businesses see their own `status='processed'` rows. Operators see all rows for their org including pending/error.

**⚠ One-way door — denormalized `operator_org_id`:** `usage_periods` stores `operator_org_id` directly (rather than deriving it via `business_id → businesses.operator_org_id`) as an intentional performance trade-off: the operator dashboard aggregation query avoids a join on the hot path. The consequence is that if a business is ever reassigned to a different operator org (permitted by `businesses.operator_org_id SET NULL`), all existing `usage_periods` rows for that business will have a stale `operator_org_id`. Any business reassignment must include a migration to update `usage_periods.operator_org_id` in the same transaction.

---

### `20260311100200` — API keys

**`api_keys`**
```
id,
business_id FK (nullable),
operator_org_id FK (nullable),
key_hash TEXT UNIQUE,        -- SHA-256 of raw key; raw key never stored
label TEXT, scopes JSONB,    -- ["calls:read", "billing:read"]
allowed_ips TEXT[],          -- CIDR allowlist; NULL = unrestricted
expires_at, last_used_at, revoked_at,
created_by FK (auth.users), created_at
CONSTRAINT: exactly one of business_id / operator_org_id must be set
```

---

### `20260311100300` — Webhook tables

**`webhook_subscriptions`**
```
id, operator_org_id FK, url TEXT, secret TEXT (write-only),
topics TEXT[],               -- ["call.created", "billing.threshold_90"]
status (active|paused|failing),
consecutive_failure_count INT DEFAULT 0,
created_at, updated_at
```

**`webhook_deliveries`** (append-only audit log)
```
id, subscription_id FK, topic TEXT, payload JSONB,
response_status INT, response_body TEXT (first 2000 chars),
attempt_number INT, next_retry_at TIMESTAMPTZ, delivered_at TIMESTAMPTZ,
created_at
```

Initial webhook topics:
- `call.created` — new call log ingested
- `call.priority_changed` — priority updated
- `call.status_changed` — portal status changed
- `billing.threshold_75` / `.threshold_90` / `.threshold_100` — **bucket-type plans only.** Threshold is calculated as `(total_minutes_used / bucket_rule.included_minutes) * 100`. If a business has no active `bucket`-type billing rule, these webhooks never fire. If a business has multiple bucket rules, each is evaluated independently and thresholds fire per-rule.
- `usage.upload_processed` — CSV processed successfully
- `usage.upload_failed` — CSV processing failed

**Webhook retry policy:** A delivery that receives a non-2xx response or times out (10s) is retried with exponential backoff: 1min → 2min → 4min → 8min → 16min → 32min → 60min cap. Maximum 10 attempts per delivery. After 10 failed attempts the delivery is marked dead (`next_retry_at=NULL`, `delivered_at=NULL`). When `consecutive_failure_count` reaches 5, `status` transitions to `'failing'` and the operator is notified by email. The operator must manually reactivate the subscription after fixing their endpoint.

---

### `20260311100400` — Billing rule templates

**`billing_rule_templates`**
```
id, operator_org_id FK, name TEXT, description TEXT,
rules JSONB,    -- array of BillingRule shapes minus id/business_id
created_at, updated_at
```

Operators define plans once ("Standard Plan", "Medical Premium") and apply on client provisioning. Shape of `rules` must stay compatible with `billing_rules` table schema.

---

## Operator Admin UI

### Auth

New server helper `getOperatorContext()` in `lib/auth/server.ts` — analogous to `getBusinessContext()`. Returns `{ operatorOrgId, userId, role }` or throws. All `/operator/` routes call `checkOperatorAccessOrThrow()` middleware.

Operator users log in via the same Supabase Auth flow. The middleware differentiates by checking `operator_users` for the current `auth.uid()`.

**Role permissions:**
| Action | admin | viewer |
|--------|-------|--------|
| View client list and detail | ✓ | ✓ |
| View billing history and usage periods | ✓ | ✓ |
| View calls tab on client detail | ✓ | ✓ |
| Upload usage CSV | ✓ | — |
| Apply billing rule template to client | ✓ | — |
| Manage API keys (create/revoke) | ✓ | — |
| Manage webhook subscriptions | ✓ | — |
| Override health score | ✓ | — |
| Edit operator settings / white-label config | ✓ | — |
| Manage `operator_users` (invite/remove) | ✓ | — |

### Routes

```
/operator/                    → redirect to /operator/clients
/operator/clients             → client list (table view)
/operator/clients/[id]        → client detail
/operator/usage               → billing ingest (upload + history)
/operator/api-webhooks        → API keys + webhook subscriptions
/operator/settings            → white-label config, billing templates
```

### Client List — `/operator/clients`

Table view. Columns: **Client name / domain**, **Health score** (colored dot + numeric), **Last login** (relative), **Calls/wk**, **Billing** (mini progress bar + %, days remaining), **→ View**.

Filter bar: search, "All / At risk / Inactive" segmented control, sort dropdown.

**Health score formula (0–100):**
| Component | Max pts | Condition | Data source |
|-----------|---------|-----------|-------------|
| Login recency | 40 | 40 → within 7d; 25 → 8–14d; 10 → 15–30d; 0 → >30d | `users_businesses.last_login_at` |
| Unresolved high-priority | 30 | 30 → none; 15 → 1–2; 0 → 3+ | `call_logs` where `priority='high'` and `portal_status NOT IN ('resolved','read')` |
| High-priority reviewed within 7d | 20 | % of high-priority calls in last 30d with `portal_status != 'new'` within 7d of arrival. 20 → ≥80%; 10 → 50–79%; 0 → <50% | `call_logs` + `message_actions` |
| Onboarding complete | 10 | 10 → wizard `status='completed'`; 0 → incomplete | `answering_service_wizard_sessions` |

Note: billing usage is NOT a health score component — high usage indicates a healthy active client. It surfaces separately as its own signal in the billing column.

Note: `CallRating.tsx` exists in the codebase but does not persist ratings to a DB column in v1. A call rating component is deferred to a future health score revision once ratings data exists.

If `health_score_override` is set, that value is shown with a pin icon; the formula is not evaluated.

### Client Detail — `/operator/clients/[id]`

Four tabs:

**Overview** — health score breakdown (four components displayed individually), last login timestamp, unresolved high-priority call count, this-month vs. last-month call volume delta, onboarding status.

**Billing** — large usage bar (current period), running estimate with line items, usage period history table (date, source, total calls/minutes, status, errors). "Upload usage" button opens the ingest flow.

**Calls** — last 10 call logs for this business. Read-only; no status/priority changes from operator view.

**Settings** — active billing rules (template name + rules list), API keys issued to this business, alert contact email, health score override field.

---

## Billing Ingest Pipeline

### UI — `/operator/usage`

Two panels:

**Upload panel:**
- CSV drop zone
- Expected format displayed inline:
  ```
  date,business_id,total_calls,total_minutes[,call_type_slug,calls,minutes,...]
  2026-03-10,uuid-here,47,134.5,urgent,3,12.0,general-info,44,122.5
  ```
- On upload: per-business processing status rows (✓ processed / ⚠ warning / ✗ error with detail)
- Upload history table: last 30 uploads, timestamp, filename, businesses updated, error count

**API connection panel (future):**
- Grayed out with "Connect your billing platform directly — coming soon" + email capture

### Processing flow

1. `POST /api/v1/usage` receives CSV (multipart) or JSON array
2. Validates each row: business_id exists and belongs to operator org, date format, numeric values, call_type slugs (warn on unknown, don't reject)
3. **Upserts** `usage_periods` rows using `ON CONFLICT (business_id, period_date) DO UPDATE` — all data fields overwritten, `status` reset to `'pending'`, `processed_at` cleared. Re-uploading a day's data silently replaces the previous data. No 409 conflict.
4. Async processor (Supabase Edge Function or background job) aggregates and sets `status='processed'`
5. On error: `status='error'`, `error_detail` populated
6. On success: fires `usage.upload_processed` webhook; billing meter on client portal updates on next load

### `billingEngine.ts` update

Remove `call_logs` as input. New signature:
```ts
computeEstimate(usagePeriods: UsagePeriod[], billingRules: BillingRule[]): BillingEstimate
```

The dashboard and billing pages read `usage_periods` (status='processed') for the current billing period and pass them to the engine.

**Current period definition:** The billing meter uses the calendar-month boundary from the existing `getCurrentPeriod()` helper (UTC month start/end). Operators with non-calendar billing cycles will see an approximation until per-business billing cycle configuration ships. `billing_periods` (closed/paid invoices) is **not affected by this feature** — it remains the source of truth for `GET /api/v1/billing/invoices` and `billingService.getPastInvoices()`. `usage_periods` feeds the running estimate only.

---

## API Surface

**Base path:** `/api/v1/`
**Auth:** `Authorization: Bearer <raw_key>` — server hashes the key and looks up `api_keys` by `key_hash`. Checks `revoked_at`, `expires_at`, IP allowlist, and required scope.
**Docs:** OpenAPI 3.1 spec served at `/api/v1/openapi.json`, generated from route definitions.

### Endpoints

| Method | Path | Scope | Notes |
|--------|------|-------|-------|
| `GET` | `/api/v1/calls` | `calls:read` | Paginated call log. Business key = own data only. Operator key: `?business_id=` is **required** — returns 400 without it. Cross-client bulk reads are not a v1 use case. |
| `GET` | `/api/v1/calls/:id` | `calls:read` | Single call with message actions |
| `GET` | `/api/v1/billing/estimate` | `billing:read` | Current period running estimate |
| `GET` | `/api/v1/billing/invoices` | `billing:read` | Invoice history |
| `GET` | `/api/v1/usage` | `billing:read` | Usage periods |
| `POST` | `/api/v1/usage` | `usage:write` | Billing ingest — operator key only |
| `GET` | `/api/v1/webhooks` | `webhooks:read` | List subscriptions (secret field excluded) |
| `POST` | `/api/v1/webhooks` | `webhooks:write` | Create subscription |
| `DELETE` | `/api/v1/webhooks/:id` | `webhooks:write` | Delete subscription |

### API key management

- Business members manage their own keys in the client portal (Settings tab → API Keys)
- Operators manage org-level keys in `/operator/api-webhooks`
- Key creation: server generates a random key, stores SHA-256 hash, returns the raw key once
- No key recovery — lost keys must be revoked and regenerated

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Operators who log into admin at least weekly | >60% within 90 days of ship |
| Clients who view billing meter at least once per period | >70% |
| Support tickets about billing surprises | -50% vs. baseline |
| Operators with at least one active webhook subscription | >30% within 60 days |
| API keys created by operator clients | Tracked; no target (new capability) |

---

## Implementation Sequence

1. **Migrations** — run five new migrations (already written)
2. **Operator auth middleware** — `getOperatorContext()`, `checkOperatorAccessOrThrow()`
3. **Operator admin shell** — layout, nav, route stubs
4. **Client list** — table view with health score computation
5. **Client detail** — four-tab layout, Overview + Settings tabs first
6. **`billingEngine.ts` update** — swap `call_logs` input for `usage_periods`
7. **Billing ingest API** — `POST /api/v1/usage`, CSV parser, processor
8. **Billing ingest UI** — upload panel + history table in `/operator/usage`
9. **Billing meter on client portal** — usage bar widget on dashboard
10. **Billing alerts** — threshold detection on ingest + email at 75%/90%/100%
11. **API auth middleware** — key hash lookup, scope check, IP check
12. **REST endpoints** — calls, billing, usage, webhooks
13. **Webhook delivery** — subscription management, delivery queue, retry logic
14. **OpenAPI spec** — generated from routes, served at `/api/v1/openapi.json`
15. **Client-facing API key management** — Settings tab on client portal

---

## Open Questions

- **Async processor for usage ingest:** Supabase Edge Function (simpler, no extra infra) vs. a Next.js background route with a queue (more control). Decision deferred to implementation planning.
- **Billing alert delivery:** Email only in v1 (via Supabase Auth email or a transactional provider). SMS and in-portal notification are future.
- **Operator signup flow:** How do new operators get an `operator_orgs` row? Manual provisioning via service role in v1. Self-serve signup is future work.
