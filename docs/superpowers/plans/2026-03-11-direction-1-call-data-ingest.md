# Direction 1: Call Data Ingest Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the platform to accept real call data from any telephony system via JSON API or CSV upload, auto-assign message priority, store call recordings, and let operators manage reusable billing rate card templates.

**Architecture:** Four independent-ish phases. Phases 1–3 build on each other (ingest → priority → recording). Phase 4 (billing templates) is fully independent. All call log inserts use the service role client (no INSERT RLS exists on `call_logs`). Priority assignment is a pure function that falls back to keyword-based rules when a business has no wizard config. The adapter layer normalises any input to the existing `CallLog` DB shape — no new tables or schema changes required.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase JS v2, `@/lib/supabase/service` (service role), Jest + `jest.mock`, Tailwind + shadcn/ui for the template UI.

**Run tests with:** `npx jest --testPathPattern=<path> --no-coverage`

---

## Chunk 1: Call Log Ingest Service + POST /api/v1/calls

### Task 1: Call Ingest Service — core logic

**Files:**
- Create: `lib/services/operator/callIngestService.ts`
- Create: `lib/services/operator/__tests__/callIngestService.test.ts`

This service is the write-side counterpart to `usageIngestService.ts`. It accepts raw call data (from JSON or CSV), validates it belongs to the operator's org, inserts into `call_logs` using the service role client, and fires the `call.created` webhook.

`call_logs` has no INSERT RLS policy (same pattern as `api_keys` → use `createServiceRoleClient()`).

- [ ] **Step 1: Write the failing tests**

Create `lib/services/operator/__tests__/callIngestService.test.ts`:

```typescript
import { parseCsvCallRows, validateCallRow, type RawCallInput } from '../callIngestService'

describe('parseCsvCallRows', () => {
  const header = 'timestamp,business_id,caller_name,caller_number,callback_number,call_type,direction,duration_seconds,telephony_status,message'

  it('returns empty array for header-only CSV', () => {
    expect(parseCsvCallRows(header)).toEqual([])
  })

  it('parses a single valid row', () => {
    const csv = [
      header,
      '2026-03-10T14:30:00Z,biz-123,John Smith,555-1234,555-5678,urgent,inbound,180,completed,Patient calling about refill',
    ].join('\n')
    const rows = parseCsvCallRows(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      timestamp: '2026-03-10T14:30:00Z',
      businessId: 'biz-123',
      callerName: 'John Smith',
      callType: 'urgent',
      direction: 'inbound',
      durationSeconds: 180,
      telephonyStatus: 'completed',
      message: 'Patient calling about refill',
    })
  })

  it('skips rows with missing required fields', () => {
    const csv = [header, ',biz-123,,,,urgent,inbound,0,completed,msg'].join('\n')
    expect(parseCsvCallRows(csv)).toHaveLength(0)
  })

  it('handles optional caller_name and caller_number being absent', () => {
    const csv = [
      header,
      '2026-03-10T14:30:00Z,biz-123,,,, general-info,inbound,120,completed,Test message',
    ].join('\n')
    const rows = parseCsvCallRows(csv)
    expect(rows).toHaveLength(1)
    expect(rows[0].callerName).toBeUndefined()
  })

  it('returns empty array when required headers are missing', () => {
    expect(parseCsvCallRows('date,business_id\n2026-01-01,biz-1')).toEqual([])
  })
})

describe('validateCallRow', () => {
  const validRow: RawCallInput = {
    timestamp: '2026-03-10T14:30:00Z',
    businessId: 'biz-123',
    callType: 'urgent',
    direction: 'inbound',
    durationSeconds: 180,
    telephonyStatus: 'completed',
    message: 'Test message',
  }

  it('accepts a valid row', () => {
    expect(validateCallRow(validRow, ['biz-123'])).toEqual({ valid: true })
  })

  it('rejects when businessId not in allowedIds', () => {
    const result = validateCallRow(validRow, ['other-biz'])
    expect(result.valid).toBe(false)
    expect(result.issue).toMatch(/does not belong/)
  })

  it('rejects empty message', () => {
    const result = validateCallRow({ ...validRow, message: '' }, ['biz-123'])
    expect(result.valid).toBe(false)
    expect(result.issue).toMatch(/message/)
  })

  it('rejects invalid direction', () => {
    const result = validateCallRow(
      { ...validRow, direction: 'sideways' as RawCallInput['direction'] },
      ['biz-123']
    )
    expect(result.valid).toBe(false)
  })

  it('rejects invalid telephonyStatus', () => {
    const result = validateCallRow(
      { ...validRow, telephonyStatus: 'ringing' as RawCallInput['telephonyStatus'] },
      ['biz-123']
    )
    expect(result.valid).toBe(false)
  })

  it('rejects negative durationSeconds', () => {
    const result = validateCallRow({ ...validRow, durationSeconds: -1 }, ['biz-123'])
    expect(result.valid).toBe(false)
  })

  it('rejects invalid timestamp format', () => {
    const result = validateCallRow({ ...validRow, timestamp: 'not-a-date' }, ['biz-123'])
    expect(result.valid).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest --testPathPattern=callIngestService --no-coverage
```

Expected: FAIL — `callIngestService` module not found.

- [ ] **Step 3: Implement callIngestService.ts**

Create `lib/services/operator/callIngestService.ts`:

```typescript
import { createServiceRoleClient } from '@/lib/supabase/service'
import { fireWebhookEvent } from '@/lib/services/operator/webhookService'
import { assignPriority } from '@/lib/services/operator/priorityEngine'
import { logger } from '@/lib/utils/logger'

export interface RawCallInput {
  timestamp: string               // ISO 8601 required
  businessId: string
  callerName?: string
  callerNumber?: string
  callbackNumber?: string
  callType: string                // slug e.g. 'urgent', 'new-client'
  direction: 'inbound' | 'outbound'
  durationSeconds: number         // 0 for missed/voicemail
  telephonyStatus: 'completed' | 'missed' | 'voicemail'
  message: string                 // agent's written note — must not be empty
}

export interface CallValidationResult {
  valid: boolean
  issue?: string
}

export interface CallIngestResult {
  businessId: string
  status: 'inserted' | 'error'
  callId?: string
  issue?: string
}

const VALID_DIRECTIONS = new Set(['inbound', 'outbound'])
const VALID_TELEPHONY_STATUSES = new Set(['completed', 'missed', 'voicemail'])

export function validateCallRow(
  row: RawCallInput,
  allowedBusinessIds: string[]
): CallValidationResult {
  if (!allowedBusinessIds.includes(row.businessId)) {
    return { valid: false, issue: `business_id "${row.businessId}" does not belong to this operator org.` }
  }
  if (!row.timestamp || isNaN(Date.parse(row.timestamp))) {
    return { valid: false, issue: 'timestamp must be a valid ISO 8601 date string.' }
  }
  if (!row.message || row.message.trim().length === 0) {
    return { valid: false, issue: 'message must not be empty.' }
  }
  if (!VALID_DIRECTIONS.has(row.direction)) {
    return { valid: false, issue: `direction must be "inbound" or "outbound", got "${row.direction}".` }
  }
  if (!VALID_TELEPHONY_STATUSES.has(row.telephonyStatus)) {
    return { valid: false, issue: `telephony_status must be "completed", "missed", or "voicemail", got "${row.telephonyStatus}".` }
  }
  if (row.durationSeconds < 0) {
    return { valid: false, issue: `duration_seconds must be >= 0, got ${row.durationSeconds}.` }
  }
  if (!row.callType || row.callType.trim().length === 0) {
    return { valid: false, issue: 'call_type must not be empty.' }
  }
  return { valid: true }
}

/**
 * Parse a CSV string of call log records.
 *
 * Expected header (order matters):
 *   timestamp,business_id,caller_name,caller_number,callback_number,call_type,direction,duration_seconds,telephony_status,message
 *
 * caller_name, caller_number, callback_number may be empty strings (treated as absent).
 * message may contain commas if quoted.
 */
export function parseCsvCallRows(csv: string): RawCallInput[] {
  const lines = csv.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map((h) => h.trim())
  const requiredHeaders = [
    'timestamp', 'business_id', 'call_type', 'direction',
    'duration_seconds', 'telephony_status', 'message',
  ]
  if (requiredHeaders.some((h) => !headers.includes(h))) return []

  const idx = (name: string) => headers.indexOf(name)

  const rows: RawCallInput[] = []

  for (let i = 1; i < lines.length; i++) {
    // Simple CSV split — handles quoted fields with commas
    const cols = splitCsvLine(lines[i])
    if (cols.length < headers.length) continue

    const timestamp = cols[idx('timestamp')]?.trim()
    const businessId = cols[idx('business_id')]?.trim()
    const callType = cols[idx('call_type')]?.trim()
    const direction = cols[idx('direction')]?.trim()
    const durationSeconds = parseInt(cols[idx('duration_seconds')] ?? '', 10)
    const telephonyStatus = cols[idx('telephony_status')]?.trim()
    const message = cols[idx('message')]?.trim()

    if (!timestamp || !businessId || !callType || !direction || isNaN(durationSeconds) || !telephonyStatus || !message) {
      continue
    }

    const row: RawCallInput = {
      timestamp,
      businessId,
      callType,
      direction: direction as RawCallInput['direction'],
      durationSeconds,
      telephonyStatus: telephonyStatus as RawCallInput['telephonyStatus'],
      message,
    }

    const callerName = cols[idx('caller_name')]?.trim()
    if (callerName) row.callerName = callerName

    const callerNumber = cols[idx('caller_number')]?.trim()
    if (callerNumber) row.callerNumber = callerNumber

    const callbackNumber = cols[idx('callback_number')]?.trim()
    if (callbackNumber) row.callbackNumber = callbackNumber

    rows.push(row)
  }

  return rows
}

function splitCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      result.push(current)
      current = ''
    } else {
      current += char
    }
  }
  result.push(current)
  return result
}

/**
 * Ingest a batch of raw call inputs for the given operator.
 * Validates each row, assigns priority, inserts into call_logs, fires webhooks.
 * Uses service role client — call_logs has no INSERT RLS policy.
 */
export async function ingestCalls(
  rows: RawCallInput[],
  operatorOrgId: string,
  allowedBusinessIds: string[]
): Promise<CallIngestResult[]> {
  const supabase = createServiceRoleClient()
  const results: CallIngestResult[] = []

  for (const row of rows) {
    const validation = validateCallRow(row, allowedBusinessIds)

    if (!validation.valid) {
      results.push({ businessId: row.businessId, status: 'error', issue: validation.issue })
      continue
    }

    const priority = assignPriority(row.callType)

    const { data, error } = await supabase
      .from('call_logs')
      .insert({
        business_id: row.businessId,
        timestamp: row.timestamp,
        caller_name: row.callerName ?? null,
        caller_number: row.callerNumber ?? null,
        callback_number: row.callbackNumber ?? null,
        call_type: row.callType,
        direction: row.direction,
        duration_seconds: row.durationSeconds,
        telephony_status: row.telephonyStatus,
        message: row.message,
        priority,
        portal_status: 'new',
        has_recording: false,
      })
      .select('id')
      .single()

    if (error || !data) {
      logger.error('Failed to insert call log', { businessId: row.businessId, error })
      results.push({ businessId: row.businessId, status: 'error', issue: 'Database write failed.' })
      continue
    }

    const callId = (data as { id: string }).id

    await fireWebhookEvent(operatorOrgId, 'call.created', {
      callId,
      businessId: row.businessId,
      callType: row.callType,
      priority,
      timestamp: row.timestamp,
    }).catch((err) => logger.error('Failed to fire call.created webhook', { err }))

    results.push({ businessId: row.businessId, status: 'inserted', callId })
  }

  return results
}
```

> **Note:** `assignPriority` is imported from `priorityEngine.ts`, which is built in Task 5. For now, create a temporary stub so the module compiles: `lib/services/operator/priorityEngine.ts` with `export function assignPriority(_callType: string): 'high' | 'medium' | 'low' { return 'low' }`. Task 5 will replace this with the real implementation.

- [ ] **Step 4: Create the temporary priority engine stub**

Create `lib/services/operator/priorityEngine.ts`:

```typescript
import type { MessagePriority } from '@/types/answeringService'

// Stub — replaced in Task 5 with keyword-based fallback logic.
export function assignPriority(_callType: string): MessagePriority {
  return 'low'
}
```

- [ ] **Step 5: Run tests again — they should pass now**

```bash
npx jest --testPathPattern=callIngestService --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/services/operator/callIngestService.ts lib/services/operator/priorityEngine.ts lib/services/operator/__tests__/callIngestService.test.ts
git commit -m "feat: add call ingest service with CSV parser and validation"
```

---

### Task 2: POST /api/v1/calls route handler

**Files:**
- Modify: `app/api/v1/calls/route.ts` (currently GET-only; add POST)

The POST route follows the same hybrid auth pattern as `POST /api/v1/usage`: accepts `Authorization: Bearer <key>` with `calls:write` scope, OR an operator session cookie with `admin` role. The `calls:write` scope doesn't exist yet in the scope guard — it just needs to be passed as the required scope to `validateBearerToken`.

- [ ] **Step 1: Write the failing test**

Create `app/api/v1/calls/__tests__/route.test.ts`:

```typescript
/**
 * Smoke tests for POST /api/v1/calls.
 * Full integration tests would require a real Supabase instance;
 * these verify auth guard behaviour using mocks.
 */
import { POST } from '../route'
import { NextRequest } from 'next/server'

jest.mock('@/lib/api/bearerAuth', () => ({
  validateBearerToken: jest.fn(),
}))
jest.mock('@/lib/auth/server', () => ({
  getOperatorContext: jest.fn(),
}))
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({ data: [], error: null })),
    })),
  })),
}))
jest.mock('@/lib/services/operator/callIngestService', () => ({
  ingestCalls: jest.fn(() => []),
  parseCsvCallRows: jest.fn(() => []),
}))

const { validateBearerToken } = require('@/lib/api/bearerAuth') as { validateBearerToken: jest.Mock }
const { getOperatorContext } = require('@/lib/auth/server') as { getOperatorContext: jest.Mock }

function makeRequest(body: unknown, contentType = 'application/json'): NextRequest {
  return new NextRequest('http://localhost/api/v1/calls', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/calls', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when no auth provided', async () => {
    validateBearerToken.mockResolvedValue({ valid: false, status: 401, message: 'Missing auth' })
    getOperatorContext.mockResolvedValue(null)
    const res = await POST(makeRequest([]))
    expect(res.status).toBe(401)
  })

  it('returns 403 when bearer token lacks calls:write scope', async () => {
    validateBearerToken.mockResolvedValue({ valid: false, status: 403, message: 'API key missing required scope: calls:write.' })
    const res = await POST(makeRequest([]))
    expect(res.status).toBe(403)
  })

  it('returns 400 when body is not an array', async () => {
    validateBearerToken.mockResolvedValue({ valid: false, status: 401, message: 'no auth' })
    getOperatorContext.mockResolvedValue({ operatorOrgId: 'org-1', role: 'admin', userId: 'user-1' })
    const res = await POST(makeRequest({ not: 'an array' }))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest --testPathPattern="api/v1/calls/__tests__" --no-coverage
```

Expected: FAIL — POST is not exported from route.

- [ ] **Step 3: Add POST handler to app/api/v1/calls/route.ts**

Read the current file first, then add below the existing GET export:

```typescript
export async function POST(request: NextRequest) {
  let operatorOrgId: string
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '0.0.0.0'
  const authHeader = request.headers.get('authorization')

  if (authHeader?.startsWith('Bearer ')) {
    const auth = await validateBearerToken(authHeader, 'calls:write', clientIp)
    if (!auth.valid) {
      return NextResponse.json({ error: { message: auth.message, code: 'UNAUTHORIZED' } }, { status: auth.status })
    }
    if (!auth.operatorOrgId) {
      return NextResponse.json(
        { error: { message: 'calls:write requires an operator-scoped API key.', code: 'FORBIDDEN' } },
        { status: 403 }
      )
    }
    operatorOrgId = auth.operatorOrgId
  } else {
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
    const allowedIds = (businesses ?? []).map((b) => (b as { id: string }).id)

    let rows: RawCallInput[]
    const contentType = request.headers.get('content-type') ?? ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file') as File | null
      if (!file) {
        return NextResponse.json({ error: { message: 'Missing file field', code: 'BAD_REQUEST' } }, { status: 400 })
      }
      const csv = await file.text()
      rows = parseCsvCallRows(csv)
    } else {
      const body = await request.json() as unknown
      if (!Array.isArray(body)) {
        return NextResponse.json({ error: { message: 'Body must be a JSON array', code: 'BAD_REQUEST' } }, { status: 400 })
      }
      rows = body as RawCallInput[]
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: { message: 'No rows to process', code: 'BAD_REQUEST' } }, { status: 400 })
    }

    const results = await ingestCalls(rows, operatorOrgId, allowedIds)
    const errorCount = results.filter((r) => r.status === 'error').length

    return NextResponse.json({
      data: {
        inserted: results.filter((r) => r.status === 'inserted').length,
        errors: errorCount,
        results,
      },
    }, { status: errorCount > 0 ? 207 : 201 })
  } catch (error) {
    logger.error('POST /api/v1/calls failed', { error })
    return NextResponse.json({ error: { message: sanitizeErrorMessage(error), code: 'INTERNAL_ERROR' } }, { status: 500 })
  }
}
```

Also add the new imports at the top of `app/api/v1/calls/route.ts` (after the existing imports):

```typescript
import { getOperatorContext } from '@/lib/auth/server'
import { ingestCalls, parseCsvCallRows, type RawCallInput } from '@/lib/services/operator/callIngestService'
```

- [ ] **Step 4: Run tests — they should pass**

```bash
npx jest --testPathPattern="api/v1/calls/__tests__" --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/calls/route.ts app/api/v1/calls/__tests__/route.test.ts
git commit -m "feat: add POST /api/v1/calls for call log ingest (JSON and CSV)"
```

---

### Task 3: Operator UI — Call Log Upload Panel

**Files:**
- Create: `components/operator/CallUploadPanel.tsx`
- Modify: `app/(operator)/operator/usage/page.tsx` (add Call Log section)

The operator usage page already has a CSV panel for usage_periods. Add a sibling panel for call logs. Same UI pattern as `UsageUploadPanel.tsx`.

- [ ] **Step 1: Read UsageUploadPanel.tsx to understand the existing pattern**

```bash
cat components/operator/UsageUploadPanel.tsx
```

(Read the file, then mirror the pattern exactly.)

- [ ] **Step 2: Create CallUploadPanel.tsx**

Create `components/operator/CallUploadPanel.tsx` following the exact same structure as `UsageUploadPanel.tsx`:
- `'use client'` directive
- `useState` for `file`, `uploading`, `result`
- `handleUpload` that posts `multipart/form-data` to `/api/v1/calls`
- Shows inserted count and error count from the response
- Uses the same Tailwind classes and shadcn/ui `Button` component

```typescript
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface UploadResult {
  inserted: number
  errors: number
  results: Array<{ businessId: string; status: string; callId?: string; issue?: string }>
}

export function CallUploadPanel() {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setError(null)
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/v1/calls', { method: 'POST', body: formData })
      const json = await res.json() as { data?: UploadResult; error?: { message: string } }

      if (!res.ok && !json.data) {
        setError(json.error?.message ?? 'Upload failed.')
        return
      }
      if (json.data) setResult(json.data)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Upload a CSV of call records. Required columns:{' '}
        <code className="rounded bg-slate-100 px-1 text-xs">
          timestamp, business_id, call_type, direction, duration_seconds, telephony_status, message
        </code>
        . Optional:{' '}
        <code className="rounded bg-slate-100 px-1 text-xs">
          caller_name, caller_number, callback_number
        </code>
        .
      </p>

      <div className="flex items-center gap-4">
        <input
          type="file"
          accept=".csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-sm"
        />
        <Button onClick={handleUpload} disabled={!file || uploading} size="sm">
          {uploading ? 'Uploading…' : 'Upload'}
        </Button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm">
          <p className="font-medium text-slate-800">
            {result.inserted} inserted
            {result.errors > 0 && (
              <span className="ml-2 text-red-600">{result.errors} errors</span>
            )}
          </p>
          {result.errors > 0 && (
            <ul className="mt-2 space-y-1">
              {result.results
                .filter((r) => r.status === 'error')
                .map((r, i) => (
                  <li key={i} className="text-red-600">
                    {r.businessId}: {r.issue}
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add Call Log section to usage page**

Edit `app/(operator)/operator/usage/page.tsx`. Add the new section after the existing CSV upload section and before the API Connection stub:

```typescript
import { CallUploadPanel } from '@/components/operator/CallUploadPanel'
```

Add section:

```tsx
<section>
  <h2 className="mb-4 text-base font-semibold">Upload Call Logs</h2>
  {context.role === 'admin' ? (
    <CallUploadPanel />
  ) : (
    <p className="text-sm text-slate-400">Admin role required to upload call logs.</p>
  )}
</section>
```

- [ ] **Step 4: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add components/operator/CallUploadPanel.tsx app/(operator)/operator/usage/page.tsx
git commit -m "feat: add call log CSV upload panel to operator usage page"
```

---

## Chunk 2: Priority Assignment Engine

### Task 4: Priority Engine — pure function + wire into ingest

**Files:**
- Modify: `lib/services/operator/priorityEngine.ts` (replace stub)
- Create: `lib/services/operator/__tests__/priorityEngine.test.ts`

The priority engine maps incoming `callType` slugs to `MessagePriority`. It uses a built-in fallback map for common call types. The fallback is:
- `urgent`, `emergency`, `after-hours`, `afterhours` → `high`
- `new-client`, `new_client`, `appointment`, `callback`, `billing` → `medium`
- Everything else → `low`

This is designed as a pure function — no DB access, easy to test, easy to extend with per-business config later.

- [ ] **Step 1: Write the failing tests**

Create `lib/services/operator/__tests__/priorityEngine.test.ts`:

```typescript
import { assignPriority, buildPriorityMap, type PriorityMap } from '../priorityEngine'

describe('assignPriority (default fallback)', () => {
  it('maps urgent to high', () => {
    expect(assignPriority('urgent')).toBe('high')
  })

  it('maps emergency to high', () => {
    expect(assignPriority('emergency')).toBe('high')
  })

  it('maps after-hours to high', () => {
    expect(assignPriority('after-hours')).toBe('high')
  })

  it('maps new-client to medium', () => {
    expect(assignPriority('new-client')).toBe('medium')
  })

  it('maps appointment to medium', () => {
    expect(assignPriority('appointment')).toBe('medium')
  })

  it('maps unknown types to low', () => {
    expect(assignPriority('general-info')).toBe('low')
    expect(assignPriority('whatever')).toBe('low')
    expect(assignPriority('')).toBe('low')
  })

  it('is case-insensitive', () => {
    expect(assignPriority('URGENT')).toBe('high')
    expect(assignPriority('New-Client')).toBe('medium')
  })
})

describe('assignPriority with custom map', () => {
  const customMap: PriorityMap = {
    'vip-caller': 'high',
    'routine': 'low',
  }

  it('uses custom map when provided', () => {
    expect(assignPriority('vip-caller', customMap)).toBe('high')
    expect(assignPriority('routine', customMap)).toBe('low')
  })

  it('falls back to default for types not in custom map', () => {
    expect(assignPriority('urgent', customMap)).toBe('high')
    expect(assignPriority('general-info', customMap)).toBe('low')
  })
})

describe('buildPriorityMap', () => {
  it('builds a map from call type config array', () => {
    const config = [
      { id: 'custom-urgent', priority: 'high' as const },
      { id: 'routine-check', priority: 'low' as const },
    ]
    const map = buildPriorityMap(config)
    expect(map['custom-urgent']).toBe('high')
    expect(map['routine-check']).toBe('low')
  })

  it('returns empty object for empty config', () => {
    expect(buildPriorityMap([])).toEqual({})
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest --testPathPattern=priorityEngine --no-coverage
```

Expected: FAIL — `buildPriorityMap` not exported.

- [ ] **Step 3: Replace the priority engine stub with the real implementation**

Replace all content of `lib/services/operator/priorityEngine.ts`:

```typescript
import type { MessagePriority } from '@/types/answeringService'

export type PriorityMap = Record<string, MessagePriority>

/** Default fallback priorities for common call type slugs. */
const DEFAULT_PRIORITY_MAP: PriorityMap = {
  urgent: 'high',
  emergency: 'high',
  'after-hours': 'high',
  afterhours: 'high',
  'new-client': 'medium',
  new_client: 'medium',
  appointment: 'medium',
  callback: 'medium',
  billing: 'medium',
}

/**
 * Build a PriorityMap from a call type config array (from wizard_data.callTypes).
 * Call types without an explicit priority are omitted — the default map handles them.
 */
export function buildPriorityMap(
  config: Array<{ id: string; priority?: MessagePriority }>
): PriorityMap {
  const map: PriorityMap = {}
  for (const type of config) {
    if (type.priority) map[type.id] = type.priority
  }
  return map
}

/**
 * Assign a priority to an incoming call based on its callType slug.
 *
 * @param callType - The call type slug from the inbound record.
 * @param customMap - Optional per-business overrides (from buildPriorityMap).
 *                    If provided, custom entries are checked first, then defaults.
 * @returns MessagePriority — never throws.
 */
export function assignPriority(callType: string, customMap?: PriorityMap): MessagePriority {
  const normalized = callType.toLowerCase().trim()
  if (customMap?.[normalized]) return customMap[normalized]
  return DEFAULT_PRIORITY_MAP[normalized] ?? 'low'
}
```

- [ ] **Step 4: Run tests — they should pass**

```bash
npx jest --testPathPattern=priorityEngine --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 5: Run the full test suite to ensure no regressions**

```bash
npx jest --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/services/operator/priorityEngine.ts lib/services/operator/__tests__/priorityEngine.test.ts
git commit -m "feat: add priority engine with keyword-based fallback and custom map support"
```

---

## Chunk 3: Recording Upload

### Task 5: POST /api/v1/calls/[id]/recording

**Files:**
- Create: `app/api/v1/calls/[id]/recording/route.ts`

When an audio file is uploaded for a call, it's stored in Supabase Storage under `call-recordings/{businessId}/{callId}.mp3` (or `.wav`, `.m4a` — extension from MIME type). The `call_logs.has_recording` flag is then set to `true`. On the next GET for that call detail, `messageService.getMessage` will generate a fresh signed URL automatically (it already does this — no changes needed there).

Auth: same hybrid pattern — Bearer with `calls:write` scope OR operator session admin. The upload must verify the call belongs to the operator's org.

- [ ] **Step 1: Write the failing test**

Create `app/api/v1/calls/[id]/recording/__tests__/route.test.ts`:

```typescript
import { POST } from '../route'
import { NextRequest } from 'next/server'

jest.mock('@/lib/api/bearerAuth', () => ({ validateBearerToken: jest.fn() }))
jest.mock('@/lib/auth/server', () => ({ getOperatorContext: jest.fn() }))
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          eq: jest.fn(() => ({ maybeSingle: jest.fn(() => ({ data: null, error: null })) })),
        })),
      })),
      update: jest.fn(() => ({ eq: jest.fn(() => ({ eq: jest.fn(() => ({ error: null })) })) })),
    })),
    storage: {
      from: jest.fn(() => ({
        upload: jest.fn(() => ({ error: null })),
      })),
    },
  })),
}))

const { validateBearerToken } = require('@/lib/api/bearerAuth') as { validateBearerToken: jest.Mock }
const { getOperatorContext } = require('@/lib/auth/server') as { getOperatorContext: jest.Mock }

describe('POST /api/v1/calls/[id]/recording', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns 401 when no auth provided', async () => {
    validateBearerToken.mockResolvedValue({ valid: false, status: 401, message: 'Missing auth' })
    getOperatorContext.mockResolvedValue(null)

    const formData = new FormData()
    formData.append('file', new Blob(['audio'], { type: 'audio/mpeg' }), 'test.mp3')
    const req = new NextRequest('http://localhost/api/v1/calls/call-1/recording', {
      method: 'POST',
      body: formData,
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'call-1' }) })
    expect(res.status).toBe(401)
  })

  it('returns 404 when call not found in org', async () => {
    validateBearerToken.mockResolvedValue({ valid: false, status: 401, message: 'no auth' })
    getOperatorContext.mockResolvedValue({ operatorOrgId: 'org-1', role: 'admin', userId: 'u-1' })

    const formData = new FormData()
    formData.append('file', new Blob(['audio'], { type: 'audio/mpeg' }), 'test.mp3')
    const req = new NextRequest('http://localhost/api/v1/calls/call-1/recording', {
      method: 'POST',
      body: formData,
    })
    const res = await POST(req, { params: Promise.resolve({ id: 'call-1' }) })
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest --testPathPattern="calls/\[id\]/recording" --no-coverage
```

Expected: FAIL — route module not found.

- [ ] **Step 3: Create the recording upload route**

Create `app/api/v1/calls/[id]/recording/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { validateBearerToken } from '@/lib/api/bearerAuth'
import { getOperatorContext } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import { sanitizeErrorMessage } from '@/lib/utils/errorSanitizer'

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
}

const MAX_BYTES = 50 * 1024 * 1024 // 50 MB

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: callId } = await params
  let operatorOrgId: string
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '0.0.0.0'
  const authHeader = request.headers.get('authorization')

  if (authHeader?.startsWith('Bearer ')) {
    const auth = await validateBearerToken(authHeader, 'calls:write', clientIp)
    if (!auth.valid) {
      return NextResponse.json({ error: { message: auth.message, code: 'UNAUTHORIZED' } }, { status: auth.status })
    }
    if (!auth.operatorOrgId) {
      return NextResponse.json(
        { error: { message: 'calls:write requires an operator-scoped API key.', code: 'FORBIDDEN' } },
        { status: 403 }
      )
    }
    operatorOrgId = auth.operatorOrgId
  } else {
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
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: { message: 'Missing file field', code: 'BAD_REQUEST' } }, { status: 400 })
    }

    const ext = ALLOWED_MIME_TYPES[file.type]
    if (!ext) {
      return NextResponse.json(
        { error: { message: `Unsupported audio type: ${file.type}. Allowed: mp3, wav, m4a.`, code: 'BAD_REQUEST' } },
        { status: 400 }
      )
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: { message: 'File exceeds 50 MB limit.', code: 'BAD_REQUEST' } },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    // Verify this call belongs to the operator's org
    const { data: callRow } = await supabase
      .from('call_logs')
      .select('id, business_id')
      .eq('id', callId)
      .maybeSingle()

    if (!callRow) {
      return NextResponse.json({ error: { message: 'Call not found.', code: 'NOT_FOUND' } }, { status: 404 })
    }

    const { data: business } = await supabase
      .from('businesses')
      .select('id')
      .eq('id', (callRow as { id: string; business_id: string }).business_id)
      .eq('operator_org_id', operatorOrgId)
      .maybeSingle()

    if (!business) {
      return NextResponse.json(
        { error: { message: 'Call does not belong to your operator org.', code: 'FORBIDDEN' } },
        { status: 403 }
      )
    }

    const businessId = (callRow as { id: string; business_id: string }).business_id
    const storagePath = `${businessId}/${callId}.${ext}`
    const arrayBuffer = await file.arrayBuffer()

    const { error: uploadError } = await supabase.storage
      .from('call-recordings')
      .upload(storagePath, arrayBuffer, {
        contentType: file.type,
        upsert: true,
      })

    if (uploadError) {
      logger.error('Recording upload to storage failed', { callId, error: uploadError })
      return NextResponse.json({ error: { message: 'Storage upload failed.', code: 'INTERNAL_ERROR' } }, { status: 500 })
    }

    const { error: updateError } = await supabase
      .from('call_logs')
      .update({ has_recording: true })
      .eq('id', callId)
      .eq('business_id', businessId)

    if (updateError) {
      logger.error('Failed to set has_recording=true', { callId, error: updateError })
      // Storage upload succeeded — not a fatal error; the flag can be fixed manually
    }

    return NextResponse.json({ data: { callId, storagePath } }, { status: 201 })
  } catch (error) {
    logger.error('POST /api/v1/calls/[id]/recording failed', { callId, error })
    return NextResponse.json({ error: { message: sanitizeErrorMessage(error), code: 'INTERNAL_ERROR' } }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run tests — they should pass**

```bash
npx jest --testPathPattern="calls/\[id\]/recording" --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 5: Ensure the Supabase Storage bucket exists**

Run this in the Supabase SQL editor (or via the Supabase dashboard → Storage):

```sql
-- Create the call-recordings bucket if it doesn't already exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('call-recordings', 'call-recordings', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: allow service role to upload (already implicit)
-- RLS: allow authenticated business users to download their own recordings
CREATE POLICY "Business users can read their recordings"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'call-recordings'
  AND (storage.foldername(name))[1] IN (
    SELECT b.id::text FROM businesses b
    JOIN users_businesses ub ON ub.business_id = b.id
    WHERE ub.user_id = auth.uid()
  )
);
```

Apply this via `mcp__plugin_supabase_supabase__apply_migration` or the Supabase dashboard. The migration name: `create_call_recordings_storage_bucket`.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/calls/[id]/recording/route.ts app/api/v1/calls/[id]/recording/__tests__/route.test.ts
git commit -m "feat: add POST /api/v1/calls/[id]/recording for audio upload"
```

---

## Chunk 4: Billing Rule Template UI

### Task 6: Billing Template Service

**Files:**
- Create: `lib/services/operator/billingTemplateService.ts`
- Create: `lib/services/operator/__tests__/billingTemplateService.test.ts`

The `billing_rule_templates` table already exists (from the production migration). It stores reusable rate card presets that operators apply to client businesses. Each template is a JSON array of `BillingRule`-shaped objects scoped to an `operator_org_id`.

Schema reminder:
```sql
billing_rule_templates (
  id UUID,
  operator_org_id UUID,
  name TEXT,
  rules JSONB,  -- array of BillingRule objects (without businessId/id)
  created_at TIMESTAMPTZ
)
```

- [ ] **Step 1: Write the failing tests**

Create `lib/services/operator/__tests__/billingTemplateService.test.ts`:

```typescript
import {
  listTemplates,
  createTemplate,
  deleteTemplate,
  applyTemplateToClient,
  type BillingTemplateInput,
} from '../billingTemplateService'

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => mockSupabase),
}))

const mockInsert = jest.fn()
const mockSelect = jest.fn()
const mockDelete = jest.fn()
const mockEq = jest.fn()

const mockSupabase = {
  from: jest.fn((table: string) => {
    if (table === 'billing_rule_templates') {
      return {
        select: mockSelect,
        insert: mockInsert,
        delete: mockDelete,
      }
    }
    return { insert: jest.fn(() => ({ error: null })) }
  }),
}

describe('listTemplates', () => {
  it('returns templates for the operator org', async () => {
    mockSelect.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({
          data: [{ id: 't-1', name: 'Standard', rules: [], created_at: '2026-01-01' }],
          error: null,
        }),
      }),
    })
    const templates = await listTemplates('org-1')
    expect(templates).toHaveLength(1)
    expect(templates[0].name).toBe('Standard')
  })

  it('throws on DB error', async () => {
    mockSelect.mockReturnValue({
      eq: jest.fn().mockReturnValue({
        order: jest.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } }),
      }),
    })
    await expect(listTemplates('org-1')).rejects.toThrow()
  })
})

describe('createTemplate', () => {
  it('inserts a new template and returns it', async () => {
    mockInsert.mockReturnValue({
      select: jest.fn().mockReturnValue({
        single: jest.fn().mockResolvedValue({
          data: { id: 't-2', name: 'New Template', rules: [], created_at: '2026-01-01' },
          error: null,
        }),
      }),
    })
    const input: BillingTemplateInput = { name: 'New Template', rules: [] }
    const template = await createTemplate('org-1', input)
    expect(template.id).toBe('t-2')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest --testPathPattern=billingTemplateService --no-coverage
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement billingTemplateService.ts**

Create `lib/services/operator/billingTemplateService.ts`:

```typescript
import { createClient } from '@/lib/supabase/server'
import type { BillingRuleType } from '@/types/answeringService'

/** A billing rule as stored inside a template (no businessId or database id yet). */
export interface TemplateRule {
  type: BillingRuleType
  name: string
  amount: number                  // cents
  callTypeFilter?: string[]
  includedMinutes?: number        // bucket only
  overageRate?: number            // bucket only, cents/min
  active: boolean
}

export interface BillingTemplate {
  id: string
  operatorOrgId: string
  name: string
  rules: TemplateRule[]
  createdAt: string
}

export interface BillingTemplateInput {
  name: string
  rules: TemplateRule[]
}

interface TemplateRow {
  id: string
  operator_org_id: string
  name: string
  rules: TemplateRule[]
  created_at: string
}

function mapRow(row: TemplateRow): BillingTemplate {
  return {
    id: row.id,
    operatorOrgId: row.operator_org_id,
    name: row.name,
    rules: row.rules ?? [],
    createdAt: row.created_at,
  }
}

export async function listTemplates(operatorOrgId: string): Promise<BillingTemplate[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('billing_rule_templates')
    .select('id, operator_org_id, name, rules, created_at')
    .eq('operator_org_id', operatorOrgId)
    .order('created_at', { ascending: false })

  if (error) throw new Error('Failed to load billing templates.')
  return ((data ?? []) as TemplateRow[]).map(mapRow)
}

export async function createTemplate(
  operatorOrgId: string,
  input: BillingTemplateInput
): Promise<BillingTemplate> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('billing_rule_templates')
    .insert({ operator_org_id: operatorOrgId, name: input.name, rules: input.rules })
    .select('id, operator_org_id, name, rules, created_at')
    .single()

  if (error || !data) throw new Error('Failed to create billing template.')
  return mapRow(data as TemplateRow)
}

export async function deleteTemplate(operatorOrgId: string, templateId: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('billing_rule_templates')
    .delete()
    .eq('id', templateId)
    .eq('operator_org_id', operatorOrgId)   // scoped to operator — prevents cross-org delete

  if (error) throw new Error('Failed to delete billing template.')
}

/**
 * Copy a template's rules into billing_rules for a specific client business.
 * Existing rules for the business are NOT replaced — rules are appended.
 * Returns the count of rules inserted.
 */
export async function applyTemplateToClient(
  operatorOrgId: string,
  templateId: string,
  businessId: string
): Promise<number> {
  const supabase = await createClient()

  const { data: template, error: tplError } = await supabase
    .from('billing_rule_templates')
    .select('rules')
    .eq('id', templateId)
    .eq('operator_org_id', operatorOrgId)
    .maybeSingle()

  if (tplError || !template) throw new Error('Template not found.')

  const rules = ((template as { rules: TemplateRule[] }).rules ?? []).map((rule) => ({
    business_id: businessId,
    type: rule.type,
    name: rule.name,
    amount: rule.amount,
    call_type_filter: rule.callTypeFilter ?? null,
    included_minutes: rule.includedMinutes ?? null,
    overage_rate: rule.overageRate ?? null,
    active: rule.active,
  }))

  if (rules.length === 0) return 0

  const { error: insertError } = await supabase.from('billing_rules').insert(rules)
  if (insertError) throw new Error('Failed to apply template rules to client.')

  return rules.length
}
```

- [ ] **Step 4: Run tests — they should pass**

```bash
npx jest --testPathPattern=billingTemplateService --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/services/operator/billingTemplateService.ts lib/services/operator/__tests__/billingTemplateService.test.ts
git commit -m "feat: add billing template service (list, create, delete, apply to client)"
```

---

### Task 7: Billing Template Page + UI Component

**Files:**
- Create: `app/(operator)/operator/billing-templates/page.tsx`
- Create: `components/operator/BillingTemplateManager.tsx`
- Modify: `app/(operator)/operator/layout.tsx` (add nav link)

**What this looks like:** A simple two-section page:
1. List of existing templates (name, rule count, "Apply to client" dropdown, delete button)
2. "New template" form (name field, rule builder — start simple: one rule per row with type/name/amount inputs)

Follow the same layout pattern as `app/(operator)/operator/usage/page.tsx`.

- [ ] **Step 1: Read the operator layout to understand nav pattern**

Read `app/(operator)/operator/layout.tsx` to understand how nav links are added.

- [ ] **Step 2: Add nav item to operator layout**

Find the nav items array in `layout.tsx` and add:

```typescript
{ href: '/operator/billing-templates', label: 'Rate Cards' }
```

(Match the exact style of existing nav items in that file.)

- [ ] **Step 3: Create Server Actions for template mutations**

The page will use Next.js Server Actions to keep mutations server-side. Add at the top of `app/(operator)/operator/billing-templates/page.tsx`:

```typescript
import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import { listTemplates } from '@/lib/services/operator/billingTemplateService'
import { BillingTemplateManager } from '@/components/operator/BillingTemplateManager'

// Server actions — passed as props to the client component
import {
  createBillingTemplateAction,
  deleteBillingTemplateAction,
} from './actions'
```

Create `app/(operator)/operator/billing-templates/actions.ts`:

```typescript
'use server'

import { revalidatePath } from 'next/cache'
import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import {
  createTemplate,
  deleteTemplate,
  type BillingTemplateInput,
} from '@/lib/services/operator/billingTemplateService'

export async function createBillingTemplateAction(input: BillingTemplateInput): Promise<void> {
  const context = await checkOperatorAccessOrThrow()
  if (context.role !== 'admin') throw new Error('Admin role required.')
  await createTemplate(context.operatorOrgId, input)
  revalidatePath('/operator/billing-templates')
}

export async function deleteBillingTemplateAction(templateId: string): Promise<void> {
  const context = await checkOperatorAccessOrThrow()
  if (context.role !== 'admin') throw new Error('Admin role required.')
  await deleteTemplate(context.operatorOrgId, templateId)
  revalidatePath('/operator/billing-templates')
}
```

- [ ] **Step 4: Create the page**

Create `app/(operator)/operator/billing-templates/page.tsx`:

```typescript
import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import { listTemplates } from '@/lib/services/operator/billingTemplateService'
import { BillingTemplateManager } from '@/components/operator/BillingTemplateManager'
import { createBillingTemplateAction, deleteBillingTemplateAction } from './actions'

export default async function BillingTemplatesPage() {
  const context = await checkOperatorAccessOrThrow()
  const templates = await listTemplates(context.operatorOrgId)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Rate Card Templates</h1>
        <p className="mt-1 text-sm text-slate-500">
          Define reusable billing rule sets. Apply a template to a client to quickly set up their billing.
        </p>
      </div>

      <BillingTemplateManager
        templates={templates}
        isAdmin={context.role === 'admin'}
        createAction={createBillingTemplateAction}
        deleteAction={deleteBillingTemplateAction}
      />
    </div>
  )
}
```

- [ ] **Step 5: Create BillingTemplateManager component**

Create `components/operator/BillingTemplateManager.tsx`. This is a client component that renders the template list and a simple "new template" form with one rule:

```typescript
'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { BillingTemplate, BillingTemplateInput, TemplateRule } from '@/lib/services/operator/billingTemplateService'

const RULE_TYPES = [
  { value: 'per_call', label: 'Per call' },
  { value: 'per_minute', label: 'Per minute' },
  { value: 'flat_monthly', label: 'Flat monthly' },
  { value: 'bucket', label: 'Bucket (included + overage)' },
] as const

interface Props {
  templates: BillingTemplate[]
  isAdmin: boolean
  createAction: (input: BillingTemplateInput) => Promise<void>
  deleteAction: (id: string) => Promise<void>
}

const emptyRule = (): TemplateRule => ({
  type: 'per_call',
  name: '',
  amount: 0,
  active: true,
})

export function BillingTemplateManager({ templates, isAdmin, createAction, deleteAction }: Props) {
  const [isPending, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [rules, setRules] = useState<TemplateRule[]>([emptyRule()])
  const [error, setError] = useState<string | null>(null)

  function updateRule(index: number, patch: Partial<TemplateRule>) {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function handleCreate() {
    if (!templateName.trim()) { setError('Template name is required.'); return }
    if (rules.some((r) => !r.name.trim())) { setError('All rules must have a name.'); return }
    setError(null)

    startTransition(async () => {
      try {
        await createAction({ name: templateName.trim(), rules })
        setTemplateName('')
        setRules([emptyRule()])
        setShowForm(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create template.')
      }
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteAction(id)
    })
  }

  return (
    <div className="space-y-6">
      {/* Template list */}
      {templates.length === 0 ? (
        <p className="text-sm text-slate-500">No templates yet.</p>
      ) : (
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{t.name}</p>
                <p className="text-xs text-slate-400">{t.rules.length} rule{t.rules.length !== 1 ? 's' : ''}</p>
              </div>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:text-red-700"
                  onClick={() => handleDelete(t.id)}
                  disabled={isPending}
                >
                  Delete
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New template form */}
      {isAdmin && (
        <>
          {!showForm ? (
            <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
              + New Template
            </Button>
          ) : (
            <div className="space-y-4 rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold">New Rate Card Template</h3>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Template name</label>
                <Input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="e.g. Standard Medical"
                  className="max-w-xs"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-600">Rules</label>
                {rules.map((rule, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <select
                      value={rule.type}
                      onChange={(e) => updateRule(i, { type: e.target.value as TemplateRule['type'] })}
                      className="rounded border border-slate-200 px-2 py-1 text-sm"
                    >
                      {RULE_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <Input
                      value={rule.name}
                      onChange={(e) => updateRule(i, { name: e.target.value })}
                      placeholder="Rule name"
                      className="w-40"
                    />
                    <div className="flex items-center gap-1">
                      <span className="text-sm text-slate-400">$</span>
                      <Input
                        type="number"
                        value={rule.amount / 100}
                        onChange={(e) => updateRule(i, { amount: Math.round(parseFloat(e.target.value || '0') * 100) })}
                        placeholder="0.00"
                        className="w-24"
                        min="0"
                        step="0.01"
                      />
                    </div>
                    {rules.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setRules((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setRules((prev) => [...prev, emptyRule()])}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  + Add rule
                </button>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex gap-2">
                <Button size="sm" onClick={handleCreate} disabled={isPending}>
                  {isPending ? 'Saving…' : 'Save Template'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); setError(null) }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 7: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add \
  app/(operator)/operator/billing-templates/page.tsx \
  app/(operator)/operator/billing-templates/actions.ts \
  components/operator/BillingTemplateManager.tsx \
  app/(operator)/operator/layout.tsx
git commit -m "feat: add billing rate card templates UI for operators"
```

---

## Final: Apply Storage Migration

The `call-recordings` Supabase Storage bucket must exist in production. Apply this via the Supabase MCP:

```sql
INSERT INTO storage.buckets (id, name, public)
VALUES ('call-recordings', 'call-recordings', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Business users can read their recordings"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'call-recordings'
  AND (storage.foldername(name))[1] IN (
    SELECT b.id::text FROM businesses b
    JOIN users_businesses ub ON ub.business_id = b.id
    WHERE ub.user_id = auth.uid()
  )
);
```

Apply via Supabase MCP tool with migration name `create_call_recordings_storage_bucket`.

---

## Dependency Summary

```
Task 1 (callIngestService)  → Task 2 (POST route) → Task 3 (upload UI)
Task 4 (priorityEngine stub already in Task 1) → replaced in Task 4

Task 5 (billingTemplateService) → Task 6/7 (UI + page)

Storage migration → needed before recording upload works in production
```

## Testing the Full Flow After Implementation

Once all tasks are done, test end-to-end:

1. Create an operator-scoped API key with `calls:write` scope (via operator settings UI)
2. POST a test call: `curl -X POST https://your-app/api/v1/calls -H "Authorization: Bearer <key>" -H "Content-Type: application/json" -d '[{"timestamp":"2026-03-11T10:00:00Z","businessId":"<your-biz-id>","callType":"urgent","direction":"inbound","durationSeconds":120,"telephonyStatus":"completed","message":"Test inbound call"}]'`
3. Log into the client portal — the call should appear in messages with `high` priority
4. Check the dashboard — unread count should increment
5. Upload a rate card template via `/operator/billing-templates`
