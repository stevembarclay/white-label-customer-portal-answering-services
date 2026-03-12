# On-Call Scheduling Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let business clients configure a contact book and weekly shift schedule so the answering service can poll `GET /api/v1/on-call/current` to determine who to call at any moment.

**Architecture:** Six independent chunks. DB migration first (enables everything else). Pure schedule resolver second (pure function, no DB, TDD). Data service third (DB CRUD via service role). API route fourth. Client portal UI fifth. Operator card + scope last. All DB writes use `createServiceRoleClient()` — business users have SELECT-only RLS on the new tables. The schedule resolver is a pure function exported from `onCallScheduler.ts`, shared by both the API route and the operator server component.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase JS v2, `createServiceRoleClient()` from `@/lib/supabase/service`, `Intl.DateTimeFormat` for timezone math (no new packages), shadcn/ui, Tailwind, Jest.

**Run tests with:** `npx jest --testPathPattern=<path> --no-coverage`

---

## Chunk 1: Database Migration

### Task 1: DB migration — on_call_contacts, on_call_shifts, businesses.on_call_timezone

**Files:**
- No local files — applied via Supabase MCP

This migration creates two new tables and adds one column to `businesses`. All writes go through service role. Business users can SELECT their own rows. Operators can SELECT all rows in their org.

- [ ] **Step 1: Apply migration**

Use the Supabase MCP tool `apply_migration` with project_id `dkcnfjtrzvoehfswmtyy`, name `add_on_call_scheduling`, and the following SQL:

```sql
-- Add on_call_timezone to businesses
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS on_call_timezone TEXT;

-- on_call_contacts: reusable contact book per business
CREATE TABLE IF NOT EXISTS on_call_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  phone           TEXT NOT NULL,
  role            TEXT,
  notes           TEXT,
  display_order   INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE on_call_contacts ENABLE ROW LEVEL SECURITY;

-- Business users can read their own contacts
CREATE POLICY on_call_contacts_business_select ON on_call_contacts
  FOR SELECT USING (
    business_id IN (
      SELECT business_id FROM business_users WHERE user_id = auth.uid()
    )
  );

-- Operators can read all contacts in their org
CREATE POLICY on_call_contacts_operator_select ON on_call_contacts
  FOR SELECT USING (
    business_id IN (
      SELECT b.id FROM businesses b
      JOIN operator_orgs oo ON oo.id = b.operator_org_id
      JOIN operator_users ou ON ou.operator_org_id = oo.id
      WHERE ou.user_id = auth.uid()
    )
  );

-- on_call_shifts: recurring weekly shifts with inline escalation chain
CREATE TABLE IF NOT EXISTS on_call_shifts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  days_of_week      INT[] NOT NULL,
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,
  escalation_steps  JSONB NOT NULL DEFAULT '[]'::jsonb,
  active            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE on_call_shifts ENABLE ROW LEVEL SECURITY;

-- Business users can read their own shifts
CREATE POLICY on_call_shifts_business_select ON on_call_shifts
  FOR SELECT USING (
    business_id IN (
      SELECT business_id FROM business_users WHERE user_id = auth.uid()
    )
  );

-- Operators can read all shifts in their org
CREATE POLICY on_call_shifts_operator_select ON on_call_shifts
  FOR SELECT USING (
    business_id IN (
      SELECT b.id FROM businesses b
      JOIN operator_orgs oo ON oo.id = b.operator_org_id
      JOIN operator_users ou ON ou.operator_org_id = oo.id
      WHERE ou.user_id = auth.uid()
    )
  );
```

- [ ] **Step 2: Verify migration applied**

Run this SQL via `execute_sql`:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'businesses' AND column_name = 'on_call_timezone';
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('on_call_contacts', 'on_call_shifts');
```
Expected: 3 rows returned.

---

## Chunk 2: Schedule Resolution (Pure Function, TDD)

### Task 2: onCallScheduler.ts — timezone-aware shift matching

**Files:**
- Create: `lib/services/answering-service/onCallScheduler.ts`
- Create: `lib/services/answering-service/__tests__/onCallScheduler.test.ts`

This is the trickiest piece. The function takes a UTC `Date`, a timezone string, and arrays of shifts/contacts. It returns the active shift (or null). Pure function — no DB calls, no side effects. Easily testable.

**Key algorithm:**
1. Convert `now` to local components (dayOfWeek 0–6, minutesSinceMidnight 0–1439, localDateStr "YYYY-MM-DD") using `Intl`.
2. For each active shift, compute whether `now` falls within it:
   - Parse `start_time` and `end_time` ("HH:MM:SS") to integer minutes.
   - **Same-day** (`startMin < endMin`): active if `localDay ∈ days_of_week AND startMin <= localMin < endMin`.
   - **Overnight** (`startMin > endMin`): active if (`localDay ∈ days_of_week AND localMin >= startMin`) OR (`previousDay ∈ days_of_week AND localMin < endMin`).
   - `previousDay = (localDay + 6) % 7`
3. First matching active shift wins.
4. Compute `shiftEndsAt` (UTC Date):
   - Same-day or overnight second-half: end is today's `localDateStr` + `end_time`.
   - Overnight first-half: end is tomorrow's `localDateStr` + `end_time`.
5. Hydrate escalation chain: look up each `contactId` in contacts map, attach contact details.

**Timezone math helper (no external packages):**

To convert a local date+time to UTC, use the Swedish locale trick:
```typescript
function localTimeToUtc(localDateStr: string, timeStr: string, timezone: string): Date {
  // timeStr: "HH:MM" or "HH:MM:SS"
  const hhmm = timeStr.slice(0, 5)
  const naiveUtc = new Date(`${localDateStr}T${hhmm}:00Z`)
  const localRepr = new Date(
    new Date(naiveUtc.toLocaleString('sv', { timeZone: timezone }).replace(' ', 'T') + 'Z')
  )
  const offsetMs = naiveUtc.getTime() - localRepr.getTime()
  return new Date(naiveUtc.getTime() + offsetMs)
}
```

- [ ] **Step 1: Write the failing tests**

Create `lib/services/answering-service/__tests__/onCallScheduler.test.ts`:

```typescript
import {
  resolveActiveShift,
  type ShiftRow,
  type ContactRow,
} from '../onCallScheduler'

// Test timezone: America/New_York
// UTC-5 in winter (EST), UTC-4 in DST (EDT)
// March 2026 is DST → UTC-4

function makeContact(id: string): ContactRow {
  return { id, name: `Contact ${id}`, phone: '555-0100', role: 'Physician', notes: null }
}

function makeShift(overrides: Partial<ShiftRow>): ShiftRow {
  return {
    id: 'shift-1',
    name: 'Test Shift',
    days_of_week: [1, 2, 3, 4, 5], // Mon–Fri
    start_time: '09:00:00',
    end_time: '17:00:00',
    escalation_steps: [{ contactId: 'c1', waitMinutes: 5 }, { contactId: 'c2', waitMinutes: null }],
    active: true,
    ...overrides,
  }
}

const contacts = new Map([
  ['c1', makeContact('c1')],
  ['c2', makeContact('c2')],
])

describe('resolveActiveShift', () => {
  describe('same-day shift', () => {
    const shift = makeShift({})

    it('returns null when no shifts', () => {
      const now = new Date('2026-03-10T14:00:00Z') // Tuesday 10:00 EST
      expect(resolveActiveShift(now, 'America/New_York', [], contacts)).toBeNull()
    })

    it('matches a weekday within the shift window', () => {
      // Tuesday 2026-03-10 14:00 UTC = 10:00 EST (UTC-4 in March DST)
      const now = new Date('2026-03-10T14:00:00Z')
      const result = resolveActiveShift(now, 'America/New_York', [shift], contacts)
      expect(result).not.toBeNull()
      expect(result!.shiftId).toBe('shift-1')
      expect(result!.shiftName).toBe('Test Shift')
      expect(result!.escalationSteps).toHaveLength(2)
      expect(result!.escalationSteps[0].name).toBe('Contact c1')
      expect(result!.escalationSteps[0].waitMinutes).toBe(5)
      expect(result!.escalationSteps[1].waitMinutes).toBeNull()
    })

    it('does not match before start time', () => {
      // Tuesday 2026-03-10 12:00 UTC = 08:00 EST — before 09:00
      const now = new Date('2026-03-10T12:00:00Z')
      expect(resolveActiveShift(now, 'America/New_York', [shift], contacts)).toBeNull()
    })

    it('does not match at or after end time', () => {
      // Tuesday 2026-03-10 21:00 UTC = 17:00 EST — exactly at end (exclusive)
      const now = new Date('2026-03-10T21:00:00Z')
      expect(resolveActiveShift(now, 'America/New_York', [shift], contacts)).toBeNull()
    })

    it('does not match on a weekend', () => {
      // Saturday 2026-03-14 14:00 UTC = 10:00 EST
      const now = new Date('2026-03-14T14:00:00Z')
      expect(resolveActiveShift(now, 'America/New_York', [shift], contacts)).toBeNull()
    })

    it('returns correct shiftEndsAt for same-day shift', () => {
      // Tuesday 2026-03-10 14:00 UTC = 10:00 EST → shift ends 17:00 EST = 21:00 UTC
      const now = new Date('2026-03-10T14:00:00Z')
      const result = resolveActiveShift(now, 'America/New_York', [shift], contacts)
      expect(result!.shiftEndsAt.toISOString()).toBe('2026-03-10T21:00:00.000Z')
    })

    it('ignores inactive shifts', () => {
      const inactive = makeShift({ active: false })
      const now = new Date('2026-03-10T14:00:00Z')
      expect(resolveActiveShift(now, 'America/New_York', [inactive], contacts)).toBeNull()
    })
  })

  describe('overnight shift', () => {
    // Shift: Mon–Fri 22:00–06:00 (overnight)
    const overnightShift = makeShift({
      id: 'overnight-1',
      name: 'Overnight Coverage',
      days_of_week: [1, 2, 3, 4, 5],
      start_time: '22:00:00',
      end_time: '06:00:00',
    })

    it('matches in the first half (after 22:00 on the listed day)', () => {
      // Monday 2026-03-09 23:00 EST = 03:00 UTC Tuesday
      const now = new Date('2026-03-10T03:00:00Z') // 23:00 EST Monday
      const result = resolveActiveShift(now, 'America/New_York', [overnightShift], contacts)
      expect(result).not.toBeNull()
      expect(result!.shiftId).toBe('overnight-1')
    })

    it('matches in the second half (before 06:00 on the carry-over day)', () => {
      // Tuesday 2026-03-10 02:00 EST = 06:00 UTC Tuesday
      const now = new Date('2026-03-10T06:00:00Z') // 02:00 EST Tuesday
      const result = resolveActiveShift(now, 'America/New_York', [overnightShift], contacts)
      expect(result).not.toBeNull()
      expect(result!.shiftId).toBe('overnight-1')
    })

    it('does not match during the gap (06:00–22:00)', () => {
      // Tuesday 2026-03-10 14:00 EST = 18:00 UTC Tuesday
      const now = new Date('2026-03-10T18:00:00Z') // 14:00 EST Tuesday — gap
      expect(resolveActiveShift(now, 'America/New_York', [overnightShift], contacts)).toBeNull()
    })

    it('does not match Saturday carry-over when Friday not in days_of_week', () => {
      // shift days=[1,2,3,4,5] (Mon-Fri). Saturday 03:00 EST would be a carry-over from Friday.
      // Friday IS in [1,2,3,4,5] → should match.
      // But Sunday 03:00 EST is carry-over from Saturday which is NOT in days → no match.
      const now = new Date('2026-03-15T07:00:00Z') // Sunday 03:00 EST
      expect(resolveActiveShift(now, 'America/New_York', [overnightShift], contacts)).toBeNull()
    })

    it('shiftEndsAt is tomorrow-at-end for first-half match', () => {
      // Monday 23:00 EST (first half) → ends Tuesday 06:00 EST = 10:00 UTC
      const now = new Date('2026-03-10T03:00:00Z') // 23:00 EST Monday (UTC is next day)
      const result = resolveActiveShift(now, 'America/New_York', [overnightShift], contacts)
      expect(result!.shiftEndsAt.toISOString()).toBe('2026-03-10T10:00:00.000Z') // Tuesday 06:00 EST = 10:00 UTC
    })

    it('shiftEndsAt is today-at-end for second-half match', () => {
      // Tuesday 02:00 EST (second half) → ends Tuesday 06:00 EST = 10:00 UTC
      const now = new Date('2026-03-10T06:00:00Z') // 02:00 EST Tuesday
      const result = resolveActiveShift(now, 'America/New_York', [overnightShift], contacts)
      expect(result!.shiftEndsAt.toISOString()).toBe('2026-03-10T10:00:00.000Z')
    })
  })

  describe('Tokyo timezone (UTC+9)', () => {
    const tokyoShift = makeShift({
      days_of_week: [1], // Monday only
      start_time: '09:00:00',
      end_time: '17:00:00',
    })

    it('matches Monday Tokyo time correctly', () => {
      // Monday 2026-03-09 02:00 UTC = Monday 11:00 Tokyo
      const now = new Date('2026-03-09T02:00:00Z')
      const result = resolveActiveShift(now, 'Asia/Tokyo', [tokyoShift], contacts)
      expect(result).not.toBeNull()
    })

    it('shiftEndsAt is correct for Tokyo UTC+9', () => {
      // Monday 11:00 Tokyo → ends Monday 17:00 Tokyo = 08:00 UTC
      const now = new Date('2026-03-09T02:00:00Z')
      const result = resolveActiveShift(now, 'Asia/Tokyo', [tokyoShift], contacts)
      expect(result!.shiftEndsAt.toISOString()).toBe('2026-03-09T08:00:00.000Z')
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest --testPathPattern=onCallScheduler --no-coverage
```

Expected: FAIL — `resolveActiveShift` is not defined.

- [ ] **Step 3: Write the implementation**

Create `lib/services/answering-service/onCallScheduler.ts`:

```typescript
export interface ShiftRow {
  id: string
  name: string
  days_of_week: number[]   // 0=Sun, 1=Mon, ..., 6=Sat
  start_time: string       // "HH:MM:SS"
  end_time: string         // "HH:MM:SS"
  escalation_steps: Array<{ contactId: string; waitMinutes: number | null }>
  active: boolean
}

export interface ContactRow {
  id: string
  name: string
  phone: string
  role: string | null
  notes: string | null
}

export interface ResolvedShift {
  shiftId: string
  shiftName: string
  shiftEndsAt: Date
  escalationSteps: Array<{
    step: number
    name: string
    phone: string
    role: string | null
    notes: string | null
    waitMinutes: number | null
  }>
}

function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

function getLocalComponents(now: Date, timezone: string): {
  dayOfWeek: number
  minutesSinceMidnight: number
  localDateStr: string
} {
  // 'sv' locale gives ISO-like "YYYY-MM-DD HH:MM:SS"
  const localStr = now.toLocaleString('sv', { timeZone: timezone })
  const [datePart, timePart] = localStr.split(' ')
  const [year, month, day] = datePart.split('-').map(Number)
  const [hours, minutes] = timePart.split(':').map(Number)
  const dayOfWeek = new Date(year, month - 1, day).getDay()
  return {
    dayOfWeek,
    minutesSinceMidnight: hours * 60 + minutes,
    localDateStr: datePart,
  }
}

function addOneDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function localTimeToUtc(localDateStr: string, timeStr: string, timezone: string): Date {
  const hhmm = timeStr.slice(0, 5)
  const naiveUtc = new Date(`${localDateStr}T${hhmm}:00Z`)
  const localRepr = new Date(
    new Date(naiveUtc.toLocaleString('sv', { timeZone: timezone }).replace(' ', 'T') + 'Z')
  )
  const offsetMs = naiveUtc.getTime() - localRepr.getTime()
  return new Date(naiveUtc.getTime() + offsetMs)
}

export function resolveActiveShift(
  now: Date,
  timezone: string,
  shifts: ShiftRow[],
  contacts: Map<string, ContactRow>
): ResolvedShift | null {
  const { dayOfWeek, minutesSinceMidnight, localDateStr } = getLocalComponents(now, timezone)
  const previousDay = (dayOfWeek + 6) % 7

  for (const shift of shifts) {
    if (!shift.active) continue

    const startMin = timeToMinutes(shift.start_time)
    const endMin = timeToMinutes(shift.end_time)
    const days = shift.days_of_week

    let matched = false
    let endsDateStr = localDateStr
    let overnight = false

    if (startMin < endMin) {
      // Same-day shift
      if (days.includes(dayOfWeek) && minutesSinceMidnight >= startMin && minutesSinceMidnight < endMin) {
        matched = true
      }
    } else {
      // Overnight shift (start > end, e.g. 22:00–06:00)
      if (days.includes(dayOfWeek) && minutesSinceMidnight >= startMin) {
        // First half: current day after startMin
        matched = true
        overnight = true
        endsDateStr = addOneDay(localDateStr)
      } else if (days.includes(previousDay) && minutesSinceMidnight < endMin) {
        // Second half: carry-over from previous day
        matched = true
        endsDateStr = localDateStr
      }
    }

    if (matched) {
      const shiftEndsAt = localTimeToUtc(endsDateStr, shift.end_time, timezone)
      const escalationSteps = shift.escalation_steps.map((step, i) => {
        const contact = contacts.get(step.contactId)
        return {
          step: i + 1,
          name: contact?.name ?? 'Unknown',
          phone: contact?.phone ?? '',
          role: contact?.role ?? null,
          notes: contact?.notes ?? null,
          waitMinutes: step.waitMinutes,
        }
      })

      return {
        shiftId: shift.id,
        shiftName: shift.name,
        shiftEndsAt,
        escalationSteps,
      }
    }
  }

  return null
}
```

Also add `validateNoOverlap` to the same file, after `resolveActiveShift`:

```typescript
/**
 * Returns true if the candidate shift does NOT overlap with any shift in existingShifts.
 *
 * Two shifts overlap if they share at least one day whose coverage windows intersect.
 * For overnight shifts the window wraps midnight: it is split into two sub-windows
 * so that the intersection test stays simple (both same-day arithmetic).
 */
export function validateNoOverlap(
  candidate: ShiftRow,
  existingShifts: ShiftRow[]
): boolean {
  // Expand a shift into (day, startMin, endMin) tuples, handling overnight wrapping
  function expand(shift: ShiftRow): Array<{ day: number; start: number; end: number }> {
    const start = timeToMinutes(shift.start_time)
    const end = timeToMinutes(shift.end_time)
    const result: Array<{ day: number; start: number; end: number }> = []

    for (const day of shift.days_of_week) {
      if (start < end) {
        // Same-day: [start, end)
        result.push({ day, start, end })
      } else {
        // Overnight: first half [start, 1440) on 'day', second half [0, end) on next day
        result.push({ day, start, end: 1440 })
        const nextDay = (day + 1) % 7
        result.push({ day: nextDay, start: 0, end })
      }
    }
    return result
  }

  const candidateWindows = expand(candidate)

  for (const existing of existingShifts) {
    if (!existing.active) continue
    const existingWindows = expand(existing)

    for (const cw of candidateWindows) {
      for (const ew of existingWindows) {
        if (cw.day !== ew.day) continue
        // Overlap: [cw.start, cw.end) intersects [ew.start, ew.end)
        if (cw.start < ew.end && ew.start < cw.end) {
          return false // overlap found
        }
      }
    }
  }

  return true // no overlap
}
```

Also add overlap tests at the end of `onCallScheduler.test.ts`:

```typescript
describe('validateNoOverlap', () => {
  it('returns true when no existing shifts', () => {
    const shift = makeShift({})
    expect(validateNoOverlap(shift, [])).toBe(true)
  })

  it('returns false when same-day shifts overlap', () => {
    const a = makeShift({ id: 'a', days_of_week: [1], start_time: '08:00:00', end_time: '14:00:00' })
    const b = makeShift({ id: 'b', days_of_week: [1], start_time: '13:00:00', end_time: '18:00:00' })
    expect(validateNoOverlap(b, [a])).toBe(false)
  })

  it('returns true when same-day shifts are adjacent (no gap required)', () => {
    const a = makeShift({ id: 'a', days_of_week: [1], start_time: '08:00:00', end_time: '14:00:00' })
    const b = makeShift({ id: 'b', days_of_week: [1], start_time: '14:00:00', end_time: '18:00:00' })
    expect(validateNoOverlap(b, [a])).toBe(true) // [8,14) and [14,18) do not overlap
  })

  it('returns true when shifts cover different days', () => {
    const a = makeShift({ id: 'a', days_of_week: [1], start_time: '09:00:00', end_time: '17:00:00' })
    const b = makeShift({ id: 'b', days_of_week: [2], start_time: '09:00:00', end_time: '17:00:00' })
    expect(validateNoOverlap(b, [a])).toBe(true)
  })

  it('returns false when overnight shift overlaps with next-day shift', () => {
    // Overnight Mon–Fri 22:00–06:00 carries into next day 00:00–06:00
    const overnight = makeShift({
      id: 'on',
      days_of_week: [1],
      start_time: '22:00:00',
      end_time: '06:00:00',
    })
    // Tuesday 04:00–08:00 — overlaps with overnight carry-over [0,360) on Tuesday
    const early = makeShift({
      id: 'early',
      days_of_week: [2],
      start_time: '04:00:00',
      end_time: '08:00:00',
    })
    expect(validateNoOverlap(early, [overnight])).toBe(false)
  })

  it('returns true when inactive existing shifts are ignored', () => {
    const a = makeShift({ id: 'a', days_of_week: [1], start_time: '09:00:00', end_time: '17:00:00', active: false })
    const b = makeShift({ id: 'b', days_of_week: [1], start_time: '10:00:00', end_time: '16:00:00' })
    expect(validateNoOverlap(b, [a])).toBe(true) // a is inactive
  })
})
```

Also update the import in the test file to include `validateNoOverlap`:

```typescript
import {
  resolveActiveShift,
  validateNoOverlap,
  type ShiftRow,
  type ContactRow,
} from '../onCallScheduler'
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest --testPathPattern=onCallScheduler --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/answering-service/onCallScheduler.ts \
        lib/services/answering-service/__tests__/onCallScheduler.test.ts
git commit -m "feat: add on-call shift schedule resolver with overnight + timezone support and overlap validation"
```

---

## Chunk 3: Data Service Layer

### Task 3: onCallService.ts — contacts and shifts CRUD

**Files:**
- Create: `lib/services/answering-service/onCallService.ts`

All writes use `createServiceRoleClient()` (no INSERT/UPDATE/DELETE RLS for business users). Reads use the regular session client (SELECT RLS covers business + operator users).

- [ ] **Step 1: Write the service**

Create `lib/services/answering-service/onCallService.ts`:

```typescript
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import type { ContactRow, ShiftRow } from './onCallScheduler'

// ── Types ──────────────────────────────────────────────────────────────────

export interface OnCallContact {
  id: string
  businessId: string
  name: string
  phone: string
  role: string | null
  notes: string | null
  displayOrder: number
  createdAt: string
}

export interface OnCallShift {
  id: string
  businessId: string
  name: string
  daysOfWeek: number[]
  startTime: string
  endTime: string
  escalationSteps: Array<{ contactId: string; waitMinutes: number | null }>
  active: boolean
  createdAt: string
}

export interface UpsertContactInput {
  businessId: string
  name: string
  phone: string
  role?: string | null
  notes?: string | null
  displayOrder?: number
}

export interface UpsertShiftInput {
  businessId: string
  name: string
  daysOfWeek: number[]
  startTime: string // "HH:MM"
  endTime: string   // "HH:MM"
  escalationSteps: Array<{ contactId: string; waitMinutes: number | null }>
}

// ── Contacts ───────────────────────────────────────────────────────────────

export async function listContacts(businessId: string): Promise<OnCallContact[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('on_call_contacts')
    .select('id, business_id, name, phone, role, notes, display_order, created_at')
    .eq('business_id', businessId)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw new Error('Failed to list on-call contacts.')
  return (data ?? []).map(mapContact)
}

export async function createContact(input: UpsertContactInput): Promise<OnCallContact> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('on_call_contacts')
    .insert({
      business_id: input.businessId,
      name: input.name,
      phone: input.phone,
      role: input.role ?? null,
      notes: input.notes ?? null,
      display_order: input.displayOrder ?? 0,
    })
    .select('id, business_id, name, phone, role, notes, display_order, created_at')
    .single()

  if (error || !data) throw new Error('Failed to create on-call contact.')
  return mapContact(data)
}

export async function updateContact(
  contactId: string,
  businessId: string,
  input: Partial<UpsertContactInput>
): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('on_call_contacts')
    .update({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.phone !== undefined && { phone: input.phone }),
      ...(input.role !== undefined && { role: input.role }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.displayOrder !== undefined && { display_order: input.displayOrder }),
    })
    .eq('id', contactId)
    .eq('business_id', businessId)

  if (error) throw new Error('Failed to update on-call contact.')
}

export async function deleteContact(contactId: string, businessId: string): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('on_call_contacts')
    .delete()
    .eq('id', contactId)
    .eq('business_id', businessId)

  if (error) throw new Error('Failed to delete on-call contact.')
}

// ── Shifts ─────────────────────────────────────────────────────────────────

export async function listShifts(businessId: string): Promise<OnCallShift[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('on_call_shifts')
    .select('id, business_id, name, days_of_week, start_time, end_time, escalation_steps, active, created_at')
    .eq('business_id', businessId)
    .order('created_at', { ascending: true })

  if (error) throw new Error('Failed to list on-call shifts.')
  return (data ?? []).map(mapShift)
}

export async function createShift(input: UpsertShiftInput): Promise<OnCallShift> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('on_call_shifts')
    .insert({
      business_id: input.businessId,
      name: input.name,
      days_of_week: input.daysOfWeek,
      start_time: input.startTime,
      end_time: input.endTime,
      escalation_steps: input.escalationSteps,
    })
    .select('id, business_id, name, days_of_week, start_time, end_time, escalation_steps, active, created_at')
    .single()

  if (error || !data) throw new Error('Failed to create on-call shift.')
  return mapShift(data)
}

export async function updateShift(
  shiftId: string,
  businessId: string,
  input: Partial<UpsertShiftInput & { active: boolean }>
): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('on_call_shifts')
    .update({
      ...(input.name !== undefined && { name: input.name }),
      ...(input.daysOfWeek !== undefined && { days_of_week: input.daysOfWeek }),
      ...(input.startTime !== undefined && { start_time: input.startTime }),
      ...(input.endTime !== undefined && { end_time: input.endTime }),
      ...(input.escalationSteps !== undefined && { escalation_steps: input.escalationSteps }),
      ...(input.active !== undefined && { active: input.active }),
    })
    .eq('id', shiftId)
    .eq('business_id', businessId)

  if (error) throw new Error('Failed to update on-call shift.')
}

export async function deleteShift(shiftId: string, businessId: string): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('on_call_shifts')
    .delete()
    .eq('id', shiftId)
    .eq('business_id', businessId)

  if (error) throw new Error('Failed to delete on-call shift.')
}

// ── Timezone ───────────────────────────────────────────────────────────────

export async function getBusinessTimezone(businessId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('businesses')
    .select('on_call_timezone')
    .eq('id', businessId)
    .maybeSingle()
  return (data as { on_call_timezone?: string | null } | null)?.on_call_timezone ?? null
}

export async function setBusinessTimezone(businessId: string, timezone: string): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('businesses')
    .update({ on_call_timezone: timezone })
    .eq('id', businessId)
  if (error) throw new Error('Failed to save timezone.')
}

// ── Helpers for the scheduler ──────────────────────────────────────────────

/** Load shifts and contacts in the shape expected by resolveActiveShift */
export async function loadSchedulerData(businessId: string): Promise<{
  shifts: ShiftRow[]
  contacts: Map<string, import('./onCallScheduler').ContactRow>
}> {
  const [shifts, contacts] = await Promise.all([
    listShifts(businessId),
    listContacts(businessId),
  ])

  return {
    shifts: shifts.map((s) => ({
      id: s.id,
      name: s.name,
      days_of_week: s.daysOfWeek,
      start_time: s.startTime,
      end_time: s.endTime,
      escalation_steps: s.escalationSteps,
      active: s.active,
    })),
    contacts: new Map(
      contacts.map((c) => [
        c.id,
        { id: c.id, name: c.name, phone: c.phone, role: c.role, notes: c.notes },
      ])
    ),
  }
}

// ── Row mappers ────────────────────────────────────────────────────────────

function mapContact(row: Record<string, unknown>): OnCallContact {
  return {
    id: row.id as string,
    businessId: row.business_id as string,
    name: row.name as string,
    phone: row.phone as string,
    role: (row.role as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    displayOrder: (row.display_order as number) ?? 0,
    createdAt: row.created_at as string,
  }
}

function mapShift(row: Record<string, unknown>): OnCallShift {
  return {
    id: row.id as string,
    businessId: row.business_id as string,
    name: row.name as string,
    daysOfWeek: row.days_of_week as number[],
    startTime: row.start_time as string,
    endTime: row.end_time as string,
    escalationSteps: row.escalation_steps as Array<{ contactId: string; waitMinutes: number | null }>,
    active: row.active as boolean,
    createdAt: row.created_at as string,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/services/answering-service/onCallService.ts
git commit -m "feat: add on-call data service (contacts/shifts CRUD, service role writes)"
```

---

## Chunk 4: API Route

### Task 4: GET /api/v1/on-call/current

**Files:**
- Create: `app/api/v1/on-call/current/route.ts`
- Create: `app/api/v1/on-call/current/__tests__/route.test.ts`

Auth: Bearer token with `on_call:read` scope, OR operator session cookie (check `operator_org_id`). For session auth path, use `checkOperatorAccessOrThrow()` pattern. `business_id` required for operator keys (same pattern as billing estimate).

- [ ] **Step 1: Write the failing tests**

Create `app/api/v1/on-call/current/__tests__/route.test.ts`:

```typescript
jest.mock('@/lib/api/bearerAuth', () => ({
  validateBearerToken: jest.fn(),
}))
jest.mock('@/lib/services/answering-service/onCallService', () => ({
  getBusinessTimezone: jest.fn(),
  loadSchedulerData: jest.fn(),
}))
jest.mock('@/lib/services/answering-service/onCallScheduler', () => ({
  resolveActiveShift: jest.fn(),
}))

import { NextRequest } from 'next/server'
import { GET } from '../route'
import { validateBearerToken } from '@/lib/api/bearerAuth'
import { getBusinessTimezone, loadSchedulerData } from '@/lib/services/answering-service/onCallService'
import { resolveActiveShift } from '@/lib/services/answering-service/onCallScheduler'

const mockValidate = validateBearerToken as jest.Mock
const mockTimezone = getBusinessTimezone as jest.Mock
const mockLoad = loadSchedulerData as jest.Mock
const mockResolve = resolveActiveShift as jest.Mock

function makeRequest(businessId?: string) {
  const url = businessId
    ? `http://localhost/api/v1/on-call/current?business_id=${businessId}`
    : 'http://localhost/api/v1/on-call/current'
  return new NextRequest(url, {
    headers: { authorization: 'Bearer test-key' },
  })
}

describe('GET /api/v1/on-call/current', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when auth fails', async () => {
    mockValidate.mockResolvedValue({ valid: false, status: 401, message: 'Invalid API key.' })
    const res = await GET(makeRequest())
    expect(res.status).toBe(401)
  })

  it('returns 400 when business_id missing for operator key', async () => {
    mockValidate.mockResolvedValue({
      valid: true,
      keyId: 'k1',
      businessId: null,
      operatorOrgId: 'org-1',
      scopes: ['on_call:read'],
    })
    const res = await GET(makeRequest()) // no business_id param
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('BAD_REQUEST')
  })

  it('returns current on-call status when shift is active', async () => {
    mockValidate.mockResolvedValue({
      valid: true,
      keyId: 'k1',
      businessId: 'biz-1',
      operatorOrgId: null,
      scopes: ['on_call:read'],
    })
    mockTimezone.mockResolvedValue('America/New_York')
    mockLoad.mockResolvedValue({ shifts: [], contacts: new Map() })
    mockResolve.mockReturnValue({
      shiftId: 'shift-1',
      shiftName: 'Weeknight',
      shiftEndsAt: new Date('2026-03-10T10:00:00Z'),
      escalationSteps: [
        { step: 1, name: 'Dr. Smith', phone: '555-0100', role: 'Physician', notes: null, waitMinutes: 5 },
      ],
    })

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.shiftId).toBe('shift-1')
    expect(body.data.shiftName).toBe('Weeknight')
    expect(body.data.escalationSteps).toHaveLength(1)
    expect(body.data.shiftEndsAt).toBe('2026-03-10T10:00:00.000Z')
    expect(body.data.businessId).toBe('biz-1')
  })

  it('returns empty escalation when no shift is active', async () => {
    mockValidate.mockResolvedValue({
      valid: true,
      keyId: 'k1',
      businessId: 'biz-1',
      operatorOrgId: null,
      scopes: ['on_call:read'],
    })
    mockTimezone.mockResolvedValue('America/New_York')
    mockLoad.mockResolvedValue({ shifts: [], contacts: new Map() })
    mockResolve.mockReturnValue(null)

    const res = await GET(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.shiftId).toBeNull()
    expect(body.data.shiftEndsAt).toBeNull()
    expect(body.data.escalationSteps).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest --testPathPattern="on-call/current/__tests__" --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the route**

Create `app/api/v1/on-call/current/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'

import { validateBearerToken } from '@/lib/api/bearerAuth'
import {
  getBusinessTimezone,
  loadSchedulerData,
} from '@/lib/services/answering-service/onCallService'
import { resolveActiveShift } from '@/lib/services/answering-service/onCallScheduler'
import { sanitizeErrorMessage } from '@/lib/utils/errorSanitizer'

export async function GET(request: NextRequest) {
  const auth = await validateBearerToken(
    request.headers.get('authorization'),
    'on_call:read',
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '0.0.0.0'
  )
  if (!auth.valid) {
    return NextResponse.json(
      { error: { message: auth.message, code: 'UNAUTHORIZED' } },
      { status: auth.status }
    )
  }

  try {
    const businessId = auth.businessId ?? new URL(request.url).searchParams.get('business_id')
    if (!businessId) {
      return NextResponse.json(
        { error: { message: 'business_id required for operator keys', code: 'BAD_REQUEST' } },
        { status: 400 }
      )
    }

    const now = new Date()
    const timezone = (await getBusinessTimezone(businessId)) ?? 'America/New_York'
    const { shifts, contacts } = await loadSchedulerData(businessId)
    const resolved = resolveActiveShift(now, timezone, shifts, contacts)

    return NextResponse.json({
      data: {
        businessId,
        asOf: now.toISOString(),
        shiftId: resolved?.shiftId ?? null,
        shiftName: resolved?.shiftName ?? null,
        shiftEndsAt: resolved?.shiftEndsAt?.toISOString() ?? null,
        escalationSteps: resolved?.escalationSteps ?? [],
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: { message: sanitizeErrorMessage(error), code: 'INTERNAL_ERROR' } },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest --testPathPattern="on-call/current/__tests__" --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/on-call/current/route.ts \
        "app/api/v1/on-call/current/__tests__/route.test.ts"
git commit -m "feat: add GET /api/v1/on-call/current endpoint"
```

---

## Chunk 5: Client Portal UI

### Task 5: Add "Who to Call" to SideNav and BottomNav

**Files:**
- Modify: `components/answering-service/SideNav.tsx`
- Modify: `components/answering-service/BottomNav.tsx`

The spec says: "between Messages and Billing". Currently the ITEMS order is Messages → Dashboard → Billing → Settings.

For SideNav: add `{ href: '/answering-service/on-call', label: 'Who to Call', icon: PhoneIncoming }` between Messages and Dashboard. Import `PhoneIncoming` from `@phosphor-icons/react`.

- [ ] **Step 1: Update SideNav**

In `components/answering-service/SideNav.tsx`:

Change the import line to add `PhoneIncoming`:
```typescript
import {
  EnvelopeSimple,
  Gear,
  PhoneIncoming,
  Receipt,
  SquaresFour,
} from '@phosphor-icons/react'
```

Change `ITEMS` to:
```typescript
const ITEMS = [
  { href: '/answering-service/messages', label: 'Messages', icon: EnvelopeSimple },
  { href: '/answering-service/on-call', label: 'Who to Call', icon: PhoneIncoming },
  { href: '/answering-service/dashboard', label: 'Dashboard', icon: SquaresFour },
  { href: '/answering-service/billing', label: 'Billing', icon: Receipt },
  { href: '/answering-service/settings', label: 'Settings', icon: Gear },
] as const
```

- [ ] **Step 2: Update BottomNav**

In `components/answering-service/BottomNav.tsx`:

Change the import line to add `PhoneIncoming`:
```typescript
import {
  EnvelopeSimple,
  Gear,
  PhoneIncoming,
  Receipt,
  SquaresFour,
} from '@phosphor-icons/react'
```

Change `ITEMS` and the grid to 5 columns:
```typescript
const ITEMS = [
  { href: '/answering-service/messages', label: 'Messages', icon: EnvelopeSimple },
  { href: '/answering-service/on-call', label: 'On Call', icon: PhoneIncoming },
  { href: '/answering-service/dashboard', label: 'Dashboard', icon: SquaresFour },
  { href: '/answering-service/billing', label: 'Billing', icon: Receipt },
  { href: '/answering-service/settings', label: 'Settings', icon: Gear },
] as const
```

Change `className="grid grid-cols-4"` to `className="grid grid-cols-5"`.

- [ ] **Step 3: Commit**

```bash
git add components/answering-service/SideNav.tsx \
        components/answering-service/BottomNav.tsx
git commit -m "feat: add On-Call nav item to SideNav and BottomNav"
```

---

### Task 6: /answering-service/on-call page

**Files:**
- Create: `app/(platform)/answering-service/on-call/page.tsx`
- Create: `app/(platform)/answering-service/on-call/OnCallClient.tsx`
- Create: `app/(platform)/answering-service/on-call/ShiftBuilder.tsx`
- Create: `app/(platform)/answering-service/on-call/ContactsTab.tsx`

The server page loads contacts, shifts, timezone, and current status. Passes to `OnCallClient` which handles all interactivity.

**Language note:** The client-facing label is "Who to Call" — never "escalation" in UI text. "Escalation" only in code.

- [ ] **Step 1: Create the server page**

Create `app/(platform)/answering-service/on-call/page.tsx`:

```typescript
import { redirect } from 'next/navigation'
import { getBusinessContext } from '@/lib/auth/server'
import {
  listContacts,
  listShifts,
  getBusinessTimezone,
} from '@/lib/services/answering-service/onCallService'
import { resolveActiveShift, type ShiftRow, type ContactRow } from '@/lib/services/answering-service/onCallScheduler'
import { createClient } from '@/lib/supabase/server'
import { OnCallClient } from './OnCallClient'

export const dynamic = 'force-dynamic'

export default async function OnCallPage() {
  const context = await getBusinessContext()
  if (!context) redirect('/login')

  // Fetch contacts, shifts, and business timezone in parallel
  const [contacts, shifts, storedTimezone] = await Promise.all([
    listContacts(context.businessId),
    listShifts(context.businessId),
    getBusinessTimezone(context.businessId),
  ])

  // Fall back to wizard timezone if on_call_timezone not set yet
  let effectiveTimezone = storedTimezone
  if (!effectiveTimezone) {
    const supabase = await createClient()
    const { data: session } = await supabase
      .from('wizard_sessions')
      .select('wizard_data')
      .eq('business_id', context.businessId)
      .eq('status', 'completed')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    effectiveTimezone =
      (session?.wizard_data as { businessHours?: { timezone?: string } } | null)
        ?.businessHours?.timezone ?? 'America/New_York'
  }

  // Compute current on-call status server-side (reuse already-fetched data)
  const now = new Date()
  const contactMap = new Map<string, ContactRow>(
    contacts.map((c) => [c.id, { id: c.id, name: c.name, phone: c.phone, role: c.role, notes: c.notes }])
  )
  const schedulerShifts: ShiftRow[] = shifts.map((s) => ({
    id: s.id,
    name: s.name,
    days_of_week: s.daysOfWeek,
    start_time: s.startTime,
    end_time: s.endTime,
    escalation_steps: s.escalationSteps,
    active: s.active,
  }))
  const current = resolveActiveShift(now, effectiveTimezone, schedulerShifts, contactMap)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Who to Call</h1>
        <p className="text-sm text-slate-500 mt-1">
          Configure your contact schedule for after-hours and overflow calls.
        </p>
      </header>
      <OnCallClient
        businessId={context.businessId}
        initialContacts={contacts}
        initialShifts={shifts}
        initialTimezone={effectiveTimezone}
        currentStatus={current ? {
          shiftId: current.shiftId,
          shiftName: current.shiftName,
          shiftEndsAt: current.shiftEndsAt.toISOString(),
          escalationSteps: current.escalationSteps,
        } : null}
      />
    </div>
  )
}
```

- [ ] **Step 2: Create OnCallClient.tsx**

Create `app/(platform)/answering-service/on-call/OnCallClient.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'
import type { OnCallContact, OnCallShift } from '@/lib/services/answering-service/onCallService'
import { ShiftBuilder } from './ShiftBuilder'
import { ContactsTab } from './ContactsTab'

const COMMON_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
  { value: 'Europe/London', label: 'London (GMT/BST)' },
  { value: 'Europe/Paris', label: 'Central Europe (CET)' },
  { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
]

const DAY_ABBRS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface CurrentStatus {
  shiftId: string
  shiftName: string
  shiftEndsAt: string
  escalationSteps: Array<{
    step: number
    name: string
    phone: string
    role: string | null
    notes: string | null
    waitMinutes: number | null
  }>
}

interface OnCallClientProps {
  businessId: string
  initialContacts: OnCallContact[]
  initialShifts: OnCallShift[]
  initialTimezone: string
  currentStatus: CurrentStatus | null
}

// Shift colors — cycle through these for visual distinction
const SHIFT_COLORS = [
  'bg-blue-100 text-blue-800',
  'bg-violet-100 text-violet-800',
  'bg-emerald-100 text-emerald-800',
  'bg-amber-100 text-amber-800',
  'bg-pink-100 text-pink-800',
]

interface WeekGridProps {
  shifts: OnCallShift[]
  contacts: OnCallContact[]
}

function WeekGrid({ shifts, contacts }: WeekGridProps) {
  // Display Mon(1)→Sun(0), i.e. day indices [1,2,3,4,5,6,0]
  const displayDays: Array<{ index: number; label: string }> = [
    { index: 1, label: 'Mon' },
    { index: 2, label: 'Tue' },
    { index: 3, label: 'Wed' },
    { index: 4, label: 'Thu' },
    { index: 5, label: 'Fri' },
    { index: 6, label: 'Sat' },
    { index: 0, label: 'Sun' },
  ]

  const activeShifts = shifts.filter((s) => s.active)

  function getCoverageForDay(dayIndex: number): Array<{ shiftName: string; primaryContact: string; colorClass: string }> {
    return activeShifts.flatMap((shift, shiftIdx) => {
      const directlyCovered = shift.daysOfWeek.includes(dayIndex)
      // Overnight carry-over: shift is overnight (start > end) and the previous day is in days_of_week
      const isOvernight = shift.startTime > shift.endTime
      const prevDay = (dayIndex + 6) % 7
      const carryOver = isOvernight && shift.daysOfWeek.includes(prevDay)

      if (!directlyCovered && !carryOver) return []

      const firstStep = shift.escalationSteps[0]
      const contact = firstStep ? contacts.find((c) => c.id === firstStep.contactId) : undefined
      return [{
        shiftName: shift.name,
        primaryContact: contact?.name ?? '—',
        colorClass: SHIFT_COLORS[shiftIdx % SHIFT_COLORS.length],
      }]
    })
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-7 gap-1">
        {displayDays.map(({ index, label }) => (
          <div key={index} className="text-center text-xs font-medium text-slate-500 pb-1">
            {label}
          </div>
        ))}
        {displayDays.map(({ index }) => {
          const coverage = getCoverageForDay(index)
          return (
            <div
              key={index}
              className="min-h-[60px] rounded-md border border-slate-100 p-1 space-y-1"
            >
              {coverage.length === 0 ? (
                <div className="rounded px-1.5 py-1 bg-slate-50 text-xs text-slate-300 text-center">
                  —
                </div>
              ) : (
                coverage.map((item, i) => (
                  <div
                    key={i}
                    title={`${item.shiftName}: ${item.primaryContact}`}
                    className={`rounded px-1.5 py-1 text-xs truncate ${item.colorClass}`}
                  >
                    {item.primaryContact}
                  </div>
                ))
              )}
            </div>
          )
        })}
      </div>
      <p className="text-xs text-slate-400">
        Overnight shifts extend into the following morning — hover a shift for the exact coverage window.
      </p>
    </div>
  )
}

export function OnCallClient({
  businessId,
  initialContacts,
  initialShifts,
  initialTimezone,
  currentStatus,
}: OnCallClientProps) {
  const router = useRouter()
  const [contacts, setContacts] = useState(initialContacts)
  const [shifts, setShifts] = useState(initialShifts)
  const [timezone, setTimezone] = useState(initialTimezone)
  const [editingShift, setEditingShift] = useState<OnCallShift | null>(null)
  const [showShiftBuilder, setShowShiftBuilder] = useState(false)
  const [savingTz, setSavingTz] = useState(false)

  async function handleTimezoneChange(tz: string) {
    setTimezone(tz)
    setSavingTz(true)
    try {
      await fetch('/api/v1/internal/on-call/timezone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId, timezone: tz }),
      })
      router.refresh()
    } finally {
      setSavingTz(false)
    }
  }

  function formatShiftTime(shift: OnCallShift): string {
    const days = shift.daysOfWeek.map((d) => DAY_ABBRS[d]).join(', ')
    const start = shift.startTime.slice(0, 5)
    const end = shift.endTime.slice(0, 5)
    const overnight = shift.startTime > shift.endTime
    return `${days} · ${start}–${end}${overnight ? ' (overnight)' : ''}`
  }

  function formatEscalationInline(shift: OnCallShift): string {
    return shift.escalationSteps
      .map((step, i) => {
        const contact = contacts.find((c) => c.id === step.contactId)
        const name = contact?.name ?? 'Unknown'
        return i < shift.escalationSteps.length - 1
          ? `${name} (${step.waitMinutes ?? '?'} min)`
          : name
      })
      .join(' → ')
  }

  return (
    <div className="space-y-6">
      {/* Current Status Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Current Coverage</CardTitle>
        </CardHeader>
        <CardContent>
          {currentStatus ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span className="font-medium text-sm">{currentStatus.shiftName}</span>
                <Badge variant="secondary">Active</Badge>
              </div>
              <p className="text-xs text-slate-500">
                Ends{' '}
                {new Date(currentStatus.shiftEndsAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZoneName: 'short',
                })}
              </p>
              <div className="mt-2 space-y-1">
                {currentStatus.escalationSteps.map((step) => (
                  <div key={step.step} className="flex items-center gap-2 text-sm">
                    <span className="text-slate-400 w-4">{step.step}.</span>
                    <span className="font-medium">{step.name}</span>
                    {step.role && <span className="text-slate-500 text-xs">· {step.role}</span>}
                    {step.waitMinutes && (
                      <span className="text-slate-400 text-xs">· wait {step.waitMinutes}m</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" />
              <span className="text-sm">No coverage scheduled right now</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timezone selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-slate-700 shrink-0">Schedule timezone:</label>
        <Select value={timezone} onValueChange={handleTimezoneChange} disabled={savingTz}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMMON_TIMEZONES.map((tz) => (
              <SelectItem key={tz.value} value={tz.value}>
                {tz.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {savingTz && <span className="text-xs text-slate-400">Saving…</span>}
      </div>

      {/* Week grid — visual schedule overview */}
      <WeekGrid shifts={shifts} contacts={contacts} />

      <Tabs defaultValue="shifts">
        <TabsList>
          <TabsTrigger value="shifts">Shifts</TabsTrigger>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
        </TabsList>

        <TabsContent value="shifts" className="space-y-3 pt-4">
          {shifts.length === 0 ? (
            <p className="text-sm text-slate-400">No shifts yet. Add one to get started.</p>
          ) : (
            shifts.map((shift) => (
              <Card key={shift.id} className={shift.active ? '' : 'opacity-50'}>
                <CardContent className="py-3 px-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{shift.name}</span>
                      {!shift.active && (
                        <Badge variant="outline" className="text-xs">Inactive</Badge>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{formatShiftTime(shift)}</p>
                    <p className="text-xs text-slate-400 mt-1 truncate">{formatEscalationInline(shift)}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingShift(shift)
                      setShowShiftBuilder(true)
                    }}
                  >
                    Edit
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setEditingShift(null)
              setShowShiftBuilder(true)
            }}
          >
            + Add shift
          </Button>
        </TabsContent>

        <TabsContent value="contacts" className="pt-4">
          <ContactsTab
            businessId={businessId}
            contacts={contacts}
            onContactsChange={setContacts}
          />
        </TabsContent>
      </Tabs>

      {showShiftBuilder && (
        <ShiftBuilder
          businessId={businessId}
          contacts={contacts}
          shift={editingShift}
          timezone={timezone}
          onClose={() => {
            setShowShiftBuilder(false)
            setEditingShift(null)
          }}
          onSaved={(savedShift) => {
            setShifts((prev) =>
              editingShift
                ? prev.map((s) => (s.id === savedShift.id ? savedShift : s))
                : [...prev, savedShift]
            )
            setShowShiftBuilder(false)
            setEditingShift(null)
          }}
          onDeleted={(shiftId) => {
            setShifts((prev) => prev.filter((s) => s.id !== shiftId))
            setShowShiftBuilder(false)
            setEditingShift(null)
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create ShiftBuilder.tsx**

Create `app/(platform)/answering-service/on-call/ShiftBuilder.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet'
import { useToast } from '@/components/ui/use-toast'
import type { OnCallContact, OnCallShift } from '@/lib/services/answering-service/onCallService'

const DAY_LABELS = [
  { value: 0, label: 'Su' },
  { value: 1, label: 'M' },
  { value: 2, label: 'Tu' },
  { value: 3, label: 'W' },
  { value: 4, label: 'Th' },
  { value: 5, label: 'F' },
  { value: 6, label: 'Sa' },
]

interface ShiftBuilderProps {
  businessId: string
  contacts: OnCallContact[]
  shift: OnCallShift | null  // null = new shift
  timezone: string
  onClose: () => void
  onSaved: (shift: OnCallShift) => void
  onDeleted: (shiftId: string) => void
}

interface EscalationRow {
  contactId: string
  waitMinutes: number | null
}

export function ShiftBuilder({
  businessId,
  contacts,
  shift,
  timezone,
  onClose,
  onSaved,
  onDeleted,
}: ShiftBuilderProps) {
  const { toast } = useToast()
  const [name, setName] = useState(shift?.name ?? '')
  const [days, setDays] = useState<number[]>(shift?.daysOfWeek ?? [])
  const [startTime, setStartTime] = useState(shift?.startTime?.slice(0, 5) ?? '09:00')
  const [endTime, setEndTime] = useState(shift?.endTime?.slice(0, 5) ?? '17:00')
  const [steps, setSteps] = useState<EscalationRow[]>(
    shift?.escalationSteps?.length
      ? shift.escalationSteps
      : [{ contactId: '', waitMinutes: 5 }]
  )
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const isOvernight = startTime >= endTime && startTime !== endTime

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))
  }

  function addStep() {
    setSteps((prev) => [...prev, { contactId: '', waitMinutes: 5 }])
  }

  function removeStep(i: number) {
    setSteps((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function handleSave() {
    if (!name.trim() || days.length === 0 || steps.some((s) => !s.contactId)) {
      toast({ title: 'Please fill in all required fields.', variant: 'destructive' })
      return
    }

    setSaving(true)
    try {
      const payload = {
        businessId,
        name: name.trim(),
        daysOfWeek: days.sort(),
        startTime,
        endTime,
        escalationSteps: steps.map((s, i) => ({
          contactId: s.contactId,
          waitMinutes: i === steps.length - 1 ? null : s.waitMinutes,
        })),
      }

      const url = shift
        ? `/api/v1/internal/on-call/shifts/${shift.id}`
        : '/api/v1/internal/on-call/shifts'
      const method = shift ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        throw new Error('Failed to save shift.')
      }

      const { data } = await res.json()
      onSaved(data)
      toast({ title: shift ? 'Shift updated.' : 'Shift added.' })
    } catch {
      toast({ title: 'Failed to save shift.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!shift) return
    setDeleting(true)
    try {
      await fetch(`/api/v1/internal/on-call/shifts/${shift.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId }),
      })
      onDeleted(shift.id)
      toast({ title: 'Shift removed.' })
    } catch {
      toast({ title: 'Failed to remove shift.', variant: 'destructive' })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{shift ? 'Edit Shift' : 'Add Shift'}</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 py-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label>Shift name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Weeknight Coverage"
            />
          </div>

          {/* Days */}
          <div className="space-y-1.5">
            <Label>Days</Label>
            <div className="flex gap-1.5">
              {DAY_LABELS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => toggleDay(value)}
                  className={`h-9 w-9 rounded-lg text-xs font-medium transition-colors ${
                    days.includes(value)
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Times */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start time</Label>
              <Input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>End time</Label>
              <Input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
          {isOvernight && (
            <p className="text-xs text-amber-600 bg-amber-50 rounded-md px-3 py-2">
              This shift crosses midnight — it will cover into the following morning.
            </p>
          )}

          {/* Timezone note */}
          <p className="text-xs text-slate-400">
            Times are in <span className="font-medium">{timezone}</span>. Change timezone at the top of the page.
          </p>

          {/* Who to call chain */}
          <div className="space-y-2">
            <Label>Who to call</Label>
            {steps.map((step, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-slate-400 w-4 shrink-0">{i + 1}.</span>
                <Select
                  value={step.contactId}
                  onValueChange={(v) =>
                    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, contactId: v } : s)))
                  }
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Select contact…" />
                  </SelectTrigger>
                  <SelectContent>
                    {contacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}{c.role ? ` · ${c.role}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {i < steps.length - 1 && (
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={1}
                      max={60}
                      value={step.waitMinutes ?? ''}
                      onChange={(e) =>
                        setSteps((prev) =>
                          prev.map((s, idx) =>
                            idx === i ? { ...s, waitMinutes: parseInt(e.target.value, 10) || null } : s
                          )
                        )
                      }
                      className="w-16 text-center"
                    />
                    <span className="text-xs text-slate-400 shrink-0">min</span>
                  </div>
                )}
                {steps.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeStep(i)}
                    className="text-slate-400 hover:text-red-500 text-xs px-1"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addStep} className="mt-1">
              + Add contact to chain
            </Button>
          </div>
        </div>

        <SheetFooter className="flex-col gap-2 sm:flex-row">
          <Button onClick={handleSave} disabled={saving} className="flex-1">
            {saving ? 'Saving…' : shift ? 'Save changes' : 'Add shift'}
          </Button>
          {shift && (
            <Button
              variant="outline"
              onClick={handleDelete}
              disabled={deleting}
              className="text-red-600 hover:text-red-700"
            >
              {deleting ? 'Removing…' : 'Remove'}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 4: Create ContactsTab.tsx**

Create `app/(platform)/answering-service/on-call/ContactsTab.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import type { OnCallContact } from '@/lib/services/answering-service/onCallService'

interface ContactsTabProps {
  businessId: string
  contacts: OnCallContact[]
  onContactsChange: (contacts: OnCallContact[]) => void
}

interface ContactForm {
  id?: string
  name: string
  phone: string
  role: string
  notes: string
}

const emptyForm: ContactForm = { name: '', phone: '', role: '', notes: '' }

export function ContactsTab({ businessId, contacts, onContactsChange }: ContactsTabProps) {
  const { toast } = useToast()
  const [editing, setEditing] = useState<ContactForm | null>(null)
  const [saving, setSaving] = useState(false)

  function startAdd() {
    setEditing({ ...emptyForm })
  }

  function startEdit(contact: OnCallContact) {
    setEditing({
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      role: contact.role ?? '',
      notes: contact.notes ?? '',
    })
  }

  async function handleSave() {
    if (!editing || !editing.name.trim() || !editing.phone.trim()) {
      toast({ title: 'Name and phone are required.', variant: 'destructive' })
      return
    }

    setSaving(true)
    try {
      const url = editing.id
        ? `/api/v1/internal/on-call/contacts/${editing.id}`
        : '/api/v1/internal/on-call/contacts'
      const method = editing.id ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId,
          name: editing.name.trim(),
          phone: editing.phone.trim(),
          role: editing.role.trim() || null,
          notes: editing.notes.trim() || null,
        }),
      })

      if (!res.ok) throw new Error('Failed to save.')

      const { data } = await res.json()

      onContactsChange(
        editing.id
          ? contacts.map((c) => (c.id === editing.id ? data : c))
          : [...contacts, data]
      )
      setEditing(null)
      toast({ title: editing.id ? 'Contact updated.' : 'Contact added.' })
    } catch {
      toast({ title: 'Failed to save contact.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(contactId: string) {
    try {
      await fetch(`/api/v1/internal/on-call/contacts/${contactId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId }),
      })
      onContactsChange(contacts.filter((c) => c.id !== contactId))
      if (editing?.id === contactId) setEditing(null)
      toast({ title: 'Contact removed.' })
    } catch {
      toast({ title: 'Failed to remove contact.', variant: 'destructive' })
    }
  }

  return (
    <div className="space-y-3">
      {contacts.length === 0 && !editing && (
        <p className="text-sm text-slate-400">No contacts yet. Add one to get started.</p>
      )}

      {contacts.map((contact) => (
        <div
          key={contact.id}
          className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm"
        >
          <div className="min-w-0">
            <span className="font-medium">{contact.name}</span>
            {contact.role && <span className="text-slate-500 ml-2">· {contact.role}</span>}
            <p className="text-slate-400 text-xs mt-0.5">{contact.phone}</p>
            {contact.notes && <p className="text-slate-400 text-xs italic">{contact.notes}</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-3">
            <Button variant="outline" size="sm" onClick={() => startEdit(contact)}>
              Edit
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-red-600 hover:text-red-700"
              onClick={() => handleDelete(contact.id)}
            >
              ✕
            </Button>
          </div>
        </div>
      ))}

      {editing && (
        <div className="rounded-lg border border-slate-200 p-4 space-y-3 bg-slate-50">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="Dr. Sarah Smith"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phone *</Label>
              <Input
                value={editing.phone}
                onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                placeholder="555-0100"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Input
                value={editing.role}
                onChange={(e) => setEditing({ ...editing, role: e.target.value })}
                placeholder="Physician"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Input
                value={editing.notes}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                placeholder="Text before calling"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editing.id ? 'Update' : 'Add contact'}
            </Button>
          </div>
        </div>
      )}

      {!editing && (
        <Button variant="outline" className="w-full" onClick={startAdd}>
          + Add contact
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Create internal API routes**

The `OnCallClient` and `ContactsTab` call `/api/v1/internal/on-call/...` for mutations. These are session-cookie-authenticated internal routes (not bearer token). Create the following:

**`app/api/v1/internal/on-call/timezone/route.ts`:**
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getBusinessContext } from '@/lib/auth/server'
import { setBusinessTimezone } from '@/lib/services/answering-service/onCallService'

export async function POST(request: NextRequest) {
  const context = await getBusinessContext()
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { timezone } = await request.json()
  if (!timezone) return NextResponse.json({ error: 'timezone required' }, { status: 400 })

  await setBusinessTimezone(context.businessId, timezone)
  return NextResponse.json({ ok: true })
}
```

**`app/api/v1/internal/on-call/contacts/route.ts`:**
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getBusinessContext } from '@/lib/auth/server'
import { createContact } from '@/lib/services/answering-service/onCallService'

export async function POST(request: NextRequest) {
  const context = await getBusinessContext()
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const contact = await createContact({ ...body, businessId: context.businessId })
  return NextResponse.json({ data: contact })
}
```

**`app/api/v1/internal/on-call/contacts/[id]/route.ts`:**
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getBusinessContext } from '@/lib/auth/server'
import { updateContact, deleteContact, listContacts } from '@/lib/services/answering-service/onCallService'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await getBusinessContext()
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  await updateContact(id, context.businessId, body)

  // Re-fetch the updated contact so the client can update its local state
  const contacts = await listContacts(context.businessId)
  const updated = contacts.find((c) => c.id === id) ?? null
  return NextResponse.json({ data: updated })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await getBusinessContext()
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  await deleteContact(id, context.businessId)
  return NextResponse.json({ ok: true })
}
```

**`app/api/v1/internal/on-call/shifts/route.ts`:**
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getBusinessContext } from '@/lib/auth/server'
import { createShift, listShifts } from '@/lib/services/answering-service/onCallService'
import { validateNoOverlap } from '@/lib/services/answering-service/onCallScheduler'

export async function POST(request: NextRequest) {
  const context = await getBusinessContext()
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()

  // Overlap validation: load existing active shifts
  const existing = await listShifts(context.businessId)
  const activeShifts = existing.filter((s) => s.active)
  const candidate = {
    id: 'new',
    name: body.name,
    days_of_week: body.daysOfWeek,
    start_time: body.startTime,
    end_time: body.endTime,
    escalation_steps: body.escalationSteps ?? [],
    active: true,
  }
  const schedulerShifts = activeShifts.map((s) => ({
    id: s.id, name: s.name, days_of_week: s.daysOfWeek,
    start_time: s.startTime, end_time: s.endTime,
    escalation_steps: s.escalationSteps, active: true,
  }))
  if (!validateNoOverlap(candidate, schedulerShifts)) {
    return NextResponse.json(
      { error: 'This shift overlaps with an existing active shift.' },
      { status: 422 }
    )
  }

  const shift = await createShift({ ...body, businessId: context.businessId })
  return NextResponse.json({ data: shift })
}
```

**`app/api/v1/internal/on-call/shifts/[id]/route.ts`:**
```typescript
import { NextRequest, NextResponse } from 'next/server'
import { getBusinessContext } from '@/lib/auth/server'
import { updateShift, deleteShift, listShifts } from '@/lib/services/answering-service/onCallService'
import { validateNoOverlap } from '@/lib/services/answering-service/onCallScheduler'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await getBusinessContext()
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json()

  // Overlap validation: load existing active shifts (excluding this one)
  const existing = await listShifts(context.businessId)
  const otherShifts = existing.filter((s) => s.active && s.id !== id)
  const candidate = {
    id,
    name: body.name,
    days_of_week: body.daysOfWeek,
    start_time: body.startTime,
    end_time: body.endTime,
    escalation_steps: body.escalationSteps ?? [],
    active: true,
  }
  const otherScheduler = otherShifts.map((s) => ({
    id: s.id, name: s.name, days_of_week: s.daysOfWeek,
    start_time: s.startTime, end_time: s.endTime,
    escalation_steps: s.escalationSteps, active: true,
  }))
  if (!validateNoOverlap(candidate, otherScheduler)) {
    return NextResponse.json(
      { error: 'This shift overlaps with an existing active shift.' },
      { status: 422 }
    )
  }

  await updateShift(id, context.businessId, body)

  // Re-fetch so client has updated data
  const updated = (await listShifts(context.businessId)).find((s) => s.id === id) ?? null
  return NextResponse.json({ data: updated })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await getBusinessContext()
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  await deleteShift(id, context.businessId)
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 6: Commit**

```bash
git add \
  app/(platform)/answering-service/on-call/page.tsx \
  app/(platform)/answering-service/on-call/OnCallClient.tsx \
  app/(platform)/answering-service/on-call/ShiftBuilder.tsx \
  app/(platform)/answering-service/on-call/ContactsTab.tsx \
  app/api/v1/internal/on-call/timezone/route.ts \
  "app/api/v1/internal/on-call/contacts/route.ts" \
  "app/api/v1/internal/on-call/contacts/[id]/route.ts" \
  "app/api/v1/internal/on-call/shifts/route.ts" \
  "app/api/v1/internal/on-call/shifts/[id]/route.ts"
git commit -m "feat: add /answering-service/on-call client portal page with shift builder and contacts"
```

---

## Chunk 6: Operator Portal Card + API Scope

### Task 7: Operator "Who to Call" card

**Files:**
- Modify: `components/operator/ClientDetailTabs.tsx`
- Modify: `lib/services/operator/operatorService.ts`

Add a "Who to Call" card to the Overview tab in `ClientDetailTabs`. This requires passing the current on-call status to the component. The status is resolved server-side in `ClientDetailPage` using `loadSchedulerData` + `resolveActiveShift`.

- [ ] **Step 1: Update operatorService to export getClientOnCallStatus**

In `lib/services/operator/operatorService.ts`, add a new exported function at the end of the file:

```typescript
import { loadSchedulerData, getBusinessTimezone } from '@/lib/services/answering-service/onCallService'
import { resolveActiveShift } from '@/lib/services/answering-service/onCallScheduler'

export interface ClientOnCallStatus {
  contactName: string | null
  contactPhone: string | null
  contactRole: string | null
  shiftName: string | null
}

export async function getClientOnCallStatus(businessId: string): Promise<ClientOnCallStatus> {
  const timezone = await getBusinessTimezone(businessId) ?? 'America/New_York'
  const { shifts, contacts } = await loadSchedulerData(businessId)
  const resolved = resolveActiveShift(new Date(), timezone, shifts, contacts)

  if (!resolved || resolved.escalationSteps.length === 0) {
    return { contactName: null, contactPhone: null, contactRole: null, shiftName: null }
  }

  const first = resolved.escalationSteps[0]
  return {
    contactName: first.name,
    contactPhone: first.phone,
    contactRole: first.role,
    shiftName: resolved.shiftName,
  }
}
```

- [ ] **Step 2: Update client detail page to pass on-call status**

In `app/(operator)/operator/clients/[id]/page.tsx`, add the import and call:

```typescript
import { getClientDetail, getClientOnCallStatus } from '@/lib/services/operator/operatorService'
```

Change the data fetch to run in parallel:

```typescript
const [client, onCallStatus] = await Promise.all([
  getClientDetail(id, context.operatorOrgId),
  getClientOnCallStatus(id),
])
```

Pass to `ClientDetailTabs`:
```typescript
<ClientDetailTabs client={client} onCallStatus={onCallStatus} />
```

- [ ] **Step 3: Update ClientDetailTabs to show Who to Call card**

In `components/operator/ClientDetailTabs.tsx`, update the props and Overview tab:

```typescript
import type { ClientDetail, ClientOnCallStatus } from '@/lib/services/operator/operatorService'

export function ClientDetailTabs({
  client,
  onCallStatus,
}: {
  client: ClientDetail
  onCallStatus: ClientOnCallStatus
}) {
```

Add a "Who to Call" card to the `overview` TabsContent after the health score grid:

```tsx
{/* Who to Call (read-only) */}
<div className="rounded-md border border-slate-200 p-4">
  <h3 className="text-sm font-semibold mb-2">Who to Call</h3>
  {onCallStatus.shiftName ? (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
      <dt className="text-slate-500">Shift</dt>
      <dd>{onCallStatus.shiftName}</dd>
      <dt className="text-slate-500">Contact</dt>
      <dd>{onCallStatus.contactName ?? '—'}</dd>
      {onCallStatus.contactRole && (
        <>
          <dt className="text-slate-500">Role</dt>
          <dd>{onCallStatus.contactRole}</dd>
        </>
      )}
      {onCallStatus.contactPhone && (
        <>
          <dt className="text-slate-500">Phone</dt>
          <dd>{onCallStatus.contactPhone}</dd>
        </>
      )}
    </dl>
  ) : (
    <p className="text-sm text-slate-400">No coverage scheduled right now.</p>
  )}
</div>
```

- [ ] **Step 4: Commit**

```bash
git add \
  lib/services/operator/operatorService.ts \
  app/(operator)/operator/clients/[id]/page.tsx \
  components/operator/ClientDetailTabs.tsx
git commit -m "feat: add Who to Call read-only card to operator client detail"
```

---

### Task 8: Add on_call:read scope

**Files:**
- Modify: `lib/services/operator/apiKeyService.ts`
- Modify: `components/operator/ApiKeyManager.tsx`
- Modify: `app/(operator)/operator/api-webhooks/page.tsx`

The `on_call:read` scope is operator-only — business-scoped keys must not get it.

- [ ] **Step 1: Add scope restriction to apiKeyService**

In `lib/services/operator/apiKeyService.ts`, replace the `createApiKey` function. The full updated function (only the guard block at the top changes — add the `on_call:read` check directly after the existing `usage:write` check):

```typescript
export async function createApiKey(input: CreateKeyInput): Promise<CreateKeyResult> {
  if (input.businessId && input.scopes.includes('usage:write')) {
    throw new Error('usage:write scope cannot be issued to a business-scoped API key.')
  }
  if (input.businessId && input.scopes.includes('on_call:read')) {
    throw new Error('on_call:read scope cannot be issued to a business-scoped API key.')
  }

  const rawKey = generateRawApiKey()
  const keyHash = hashApiKey(rawKey)
  // api_keys has no INSERT RLS policy — service role required for writes
  const supabase = createServiceRoleClient()

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

  if (error || !data) {
    throw new Error('Failed to create API key.')
  }

  return { rawKey, keyId: (data as { id: string }).id }
}
```

- [ ] **Step 2: Replace ApiKeyManager with the full updated component**

Replace the entire contents of `components/operator/ApiKeyManager.tsx` with this complete file:

```typescript
'use client'

import { useState, useTransition } from 'react'

interface Key {
  id: string
  label: string
  scopes: string[]
  createdAt: string
  revokedAt: string | null
}

interface CreateKeySuccess {
  rawKey: string
}

interface CreateKeyFailure {
  error: string
}

export function ApiKeyManager({
  keys,
  onCreateKey,
  onRevokeKey,
  isAdmin,
  availableScopes = ['calls:read', 'billing:read'],
}: {
  keys: Key[]
  onCreateKey: (label: string, scopes: string[]) => Promise<CreateKeySuccess | CreateKeyFailure>
  onRevokeKey: (id: string) => Promise<void>
  isAdmin: boolean
  availableScopes?: string[]
}) {
  const [newLabel, setNewLabel] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<string[]>(
    availableScopes.filter((s) => s !== 'on_call:read' && s !== 'usage:write')
  )
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const activeKeys = keys.filter((key) => !key.revokedAt)

  function handleCreate() {
    if (!newLabel.trim()) return

    startTransition(async () => {
      setError(null)
      const result = await onCreateKey(newLabel.trim(), selectedScopes)

      if ('error' in result) {
        setError(result.error)
        return
      }

      setCreatedKey(result.rawKey)
      setNewLabel('')
    })
  }

  function handleRevoke(id: string) {
    startTransition(async () => {
      setError(null)
      try {
        await onRevokeKey(id)
      } catch (revokeError) {
        setError(revokeError instanceof Error ? revokeError.message : 'Failed to revoke API key.')
      }
    })
  }

  return (
    <div className="space-y-4">
      {createdKey && (
        <div className="rounded-md border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-800">
            API key created. Save it now, it will not be shown again.
          </p>
          <code className="mt-2 block break-all rounded bg-white px-3 py-2 text-xs">{createdKey}</code>
          <button
            type="button"
            onClick={() => setCreatedKey(null)}
            className="mt-2 text-xs text-green-700 hover:underline"
          >
            I&apos;ve saved it
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {isAdmin && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Key label"
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              className="flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={isPending || !newLabel.trim()}
              className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {isPending ? 'Working…' : 'Create key'}
            </button>
          </div>
          {availableScopes.length > 2 && (
            <div className="space-y-1 pl-1">
              <p className="text-xs text-slate-500 font-medium">Scopes</p>
              {availableScopes.map((scope) => (
                <label
                  key={scope}
                  className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope)}
                    onChange={(e) => {
                      setSelectedScopes((prev) =>
                        e.target.checked
                          ? [...prev, scope]
                          : prev.filter((s) => s !== scope)
                      )
                    }}
                    className="rounded"
                  />
                  <span className="font-mono">{scope}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <ul className="space-y-2">
        {activeKeys.map((key) => (
          <li
            key={key.id}
            className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <p className="font-medium">{key.label}</p>
              <p className="text-xs text-slate-400">{key.scopes.join(', ')}</p>
              <p className="text-xs text-slate-400">
                Created {new Date(key.createdAt).toLocaleDateString()}
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => handleRevoke(key.id)}
                disabled={isPending}
                className="shrink-0 text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>

      {activeKeys.length === 0 && <p className="text-sm text-slate-400">No active API keys.</p>}
    </div>
  )
}
```

- [ ] **Step 3: Pass availableScopes to operator ApiKeyManager**

In `app/(operator)/operator/api-webhooks/page.tsx`, update the ApiKeyManager usage:

```tsx
<ApiKeyManager
  keys={keys}
  onCreateKey={createOperatorApiKeyAction}
  onRevokeKey={revokeOperatorApiKeyAction}
  isAdmin={context.role === 'admin'}
  availableScopes={['calls:read', 'billing:read', 'usage:write', 'on_call:read']}
/>
```

- [ ] **Step 4: Commit**

```bash
git add \
  lib/services/operator/apiKeyService.ts \
  components/operator/ApiKeyManager.tsx \
  app/(operator)/operator/api-webhooks/page.tsx
git commit -m "feat: add on_call:read scope — restricted to operator keys, selectable in key manager"
```

---

## Final: Run All Tests

- [ ] **Run the full test suite**

```bash
npx jest --testPathPattern="onCallScheduler|on-call/current" --no-coverage
```

Expected: All tests PASS.
