# On-Call Scheduling — Design Spec

## Goal

Let business clients self-serve their on-call contact schedule through the client portal. The answering service operator's telephony system (Amtelco/Startel) polls a read-only API endpoint to determine who to contact for a given business at any moment. The portal handles configuration and display only — no telephony.

## Scope

**In:** Contact book, shift builder, week-view schedule display, current on-call status widget, `GET /api/v1/on-call/current` API endpoint, operator portal read-only view, `on_call:read` API scope.

**Out (v2):** Date-specific overrides (holidays, vacation cover), per-shift timezone, rotation auto-advance, webhook on on-call change.

---

## Data Model

### `on_call_contacts`
Reusable contact book for a business. Phone numbers live here — change once, all shifts update.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `business_id` | UUID FK → businesses | |
| `name` | TEXT NOT NULL | Display name |
| `phone` | TEXT NOT NULL | Number the answering service will dial |
| `role` | TEXT | "Physician", "Nurse", "Admin" — display only |
| `notes` | TEXT | e.g. "Text before calling" — shown in API response |
| `display_order` | INT DEFAULT 0 | For contact list ordering |
| `created_at` | TIMESTAMPTZ | |

### `on_call_shifts`
Time-based recurring shifts with inline escalation chains.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `business_id` | UUID FK → businesses | |
| `name` | TEXT NOT NULL | e.g. "Weeknight Coverage" |
| `days_of_week` | INT[] NOT NULL | 0=Sun…6=Sat. e.g. [1,2,3,4] = Mon–Thu |
| `start_time` | TIME NOT NULL | Local time in business timezone |
| `end_time` | TIME NOT NULL | Local time. If end_time < start_time → overnight shift |
| `escalation_steps` | JSONB NOT NULL | `[{contactId, waitMinutes}]`. Last step has `waitMinutes: null` |
| `active` | BOOLEAN DEFAULT true | Soft-disable without deleting |
| `created_at` | TIMESTAMPTZ | |

### Business timezone
Add `on_call_timezone TEXT` column to `businesses`. Pre-populated from `wizard_data.businessHours.timezone` on first visit to the on-call page, but explicitly editable. This is intentionally separate from the wizard field — an on-call physician may be in a different timezone than the office.

### RLS
- `on_call_contacts`: business users SELECT/INSERT/UPDATE/DELETE own rows. Operators SELECT all in their org.
- `on_call_shifts`: same.
- No INSERT RLS for business users exists yet — use service role client for writes (same pattern as `api_keys`).

---

## Schedule Resolution

Given timestamp T (UTC), to find the active shift for a business:

1. Convert T to the business's `on_call_timezone`.
2. Get `localDay` (0–6) and `localMinutes` (minutes since midnight).
3. For each active shift, compute whether T falls within it:
   - **Same-day shift** (`start_time < end_time`): active if `localDay` ∈ `days_of_week` AND `localMinutes` ∈ [start, end).
   - **Overnight shift** (`start_time > end_time`): active if (`localDay` ∈ `days_of_week` AND `localMinutes` ≥ start) OR (`previousDay` ∈ `days_of_week` AND `localMinutes` < end).
4. Return the single matching shift. If none matches, return empty escalation.
5. Overlap validation on save prevents multiple matches.

---

## API

### `GET /api/v1/on-call/current`

**Auth:** Bearer token with `on_call:read` scope (operator-scoped key only). Also readable via operator session cookie.

**Query params:** `business_id` (required for operator keys).

**Response:**
```json
{
  "businessId": "...",
  "asOf": "2026-03-11T22:00:00Z",
  "shiftId": "uuid-or-null",
  "shiftName": "Weeknight Coverage",
  "shiftEndsAt": "2026-03-12T13:00:00Z",
  "escalationSteps": [
    { "step": 1, "name": "Dr. Sarah Smith", "phone": "555-0100", "role": "Physician", "notes": null, "waitMinutes": 5 },
    { "step": 2, "name": "Dr. Michael Jones", "phone": "555-0101", "role": "Physician", "notes": null, "waitMinutes": 5 },
    { "step": 3, "name": "On-call Manager", "phone": "555-0102", "role": "Admin", "notes": "Text before calling", "waitMinutes": null }
  ]
}
```

When no shift is active: `shiftId: null`, `shiftEndsAt: null`, `escalationSteps: []`.

`shiftEndsAt` is returned in UTC so the polling system knows when to re-query (at the shift boundary rather than on a fixed interval).

---

## Client Portal UI

**Route:** `/answering-service/on-call`
**Nav:** Added to `SideNav` between Messages and Billing.

### Page structure

**Status card (top):** Shows current on-call contact name, role, shift name, and time until shift ends. Green when active, grey when no coverage. Escalation chain shown inline.

**Timezone selector:** Explicit dropdown above the week grid. Pre-populated from wizard data, editable. Saves to `businesses.on_call_timezone`.

**Week grid:** 7-column grid (Mon–Sun), two rows (business hours / after-hours). Cells show the primary contact's name for that slot, colour-coded by shift. Uncovered slots shown in grey. Note beneath grid: *"Overnight shifts extend into the following morning — hover a shift for exact coverage window."*

**Shift list:** Below the grid. Each shift shows name, day/time range, and escalation chain as inline text (`Dr. Smith → Dr. Jones (5 min) → Manager`). Edit button opens shift builder. "+ Add shift" at bottom.

**Contacts tab:** Simple CRUD table. Name, phone, role, notes columns. Add/edit via inline form or small modal. Reorder via drag handle or ▲▼ buttons.

### Shift builder (drawer or modal)

Fields: Name, day toggles (M T W Th F Sa Su), start time, end time, timezone (inherited, read-only in builder — change it at the page level). Midnight-crossing detection: if end < start, show yellow warning banner. Escalation chain: ordered steps picked from contacts dropdown (`+ Add contact to chain… / + Create new contact`). Each step except the last has a `waitMinutes` input. Save triggers overlap validation before insert.

### Language note
The word "escalation" does not appear in the client-facing UI. The feature is called **"Who to Call"** in the shift builder and on the page. "Escalation chain" is used only in internal code and operator-facing contexts. This avoids confusion with the wizard's existing "escalation rules" step (which governs call-handling instructions, not contact routing).

---

## Operator Portal

**`/operator/clients/[id]`:** Add a "Who to Call" card to the existing client detail page. Shows current on-call contact (name, phone, role) and shift name. Read-only. Data fetched server-side using the same resolution logic as the API — no separate endpoint needed for the UI.

---

## New API Scope

Add `on_call:read` to the scopes list in:
- `apiKeyService.ts` (scope validation)
- `ApiKeyManager` component (scope checkboxes)
- API key creation form in operator settings

Operator-scoped keys only — business-scoped keys cannot be granted `on_call:read`.

---

## What's Deferred

- **Date overrides** — one-off exceptions (holidays, vacation cover). Clients call their operator for now.
- **Webhook on on-call change** — would require a background job to fire at shift boundaries.
- **Rotation auto-advance** — "this week it's Dr. Smith, next week Dr. Jones" rotating automatically.
- **Per-call-type routing** — different "who to call" chains per call type. Complexity not justified at launch.
