// types/answeringService.ts
// Core domain types for the answering service customer portal.
// These form the adapter contract: telephony adapters must produce CallLog[]
// matching this shape. Do NOT change field names without a migration plan.

// ─── Priority & Status ─────────────────────────────────────────────────────

export type MessagePriority = 'high' | 'medium' | 'low'

/**
 * Status from the telephony system — what happened on the call.
 * Set by the adapter on ingest. Never modified by the portal.
 */
export type TelephonyStatus = 'completed' | 'missed' | 'voicemail'

/**
 * Status managed by the portal — what the business has done with the message.
 * Transitions: new → read → flagged_qa | assigned | resolved
 */
export type PortalStatus = 'new' | 'read' | 'flagged_qa' | 'assigned' | 'resolved'

// ─── Call Log ──────────────────────────────────────────────────────────────

export interface CallLog {
  id: string
  businessId: string
  timestamp: string           // ISO 8601
  callerName?: string
  callerNumber?: string       // masked or absent depending on operator config
  callbackNumber?: string
  callType: string            // slug matching wizard call types, e.g. 'urgent', 'new-client'
  direction: 'inbound' | 'outbound'
  durationSeconds: number     // 0 for missed calls and voicemails
  telephonyStatus: TelephonyStatus
  message: string             // agent's written note — the primary content
  recordingUrl?: string       // presigned URL generated fresh on each detail load; not stored in DB
  priority: MessagePriority   // system-assigned on ingest by call type rules; user-editable
  portalStatus: PortalStatus
  actions: MessageAction[]    // append-only audit log (WORM)
  isNew: boolean              // computed: timestamp > users_businesses.last_login_at for this user
}

// ─── Message Actions (audit trail) ────────────────────────────────────────

/**
 * Append-only audit log entry for actions taken on a CallLog.
 * Discriminated by `type` to enforce valid from/to values per action.
 */
export type MessageAction =
  | {
      id: string
      type: 'priority_updated'
      by: string               // UUID — user_id only, never email or display name
      at: string               // ISO 8601
      from: MessagePriority
      to: MessagePriority
    }
  | {
      id: string
      type: 'status_changed'
      by: string               // UUID — user_id only, never email or display name
      at: string               // ISO 8601
      from: PortalStatus
      to: PortalStatus
    }
  | {
      id: string
      type: 'flagged_qa'
      by: string               // UUID — user_id only, never email or display name
      at: string               // ISO 8601
    }

// ─── Dashboard ────────────────────────────────────────────────────────────

export interface DashboardSummary {
  callsThisWeek: number
  callsLastWeek: number
  callsByDay: DayCount[]      // last 7 days for SVG sparkline
  unreadCount: number
  currentMonthEstimate: number      // cents — named to match spec field name exactly
  currentMonthCallCount: number
  daysRemainingInPeriod: number
  topUnreadMessages: CallLog[] // top 3, priority+timestamp sorted, portalStatus='new'
}

export interface DayCount {
  date: string                // YYYY-MM-DD
  count: number
}

// ─── Billing ───────────────────────────────────────────────────────────────

export type BillingRuleType =
  | 'per_call'      // amount cents per call; zero-duration calls included
  | 'per_minute'    // amount cents per minute; zero-duration calls excluded
  | 'flat_monthly'  // amount cents, applied once per billing period
  | 'setup_fee'     // amount cents, applied only in the first billing period
  | 'bucket'        // included_minutes free, then overage_rate cents/min over

export interface BillingRule {
  id: string
  businessId: string
  type: BillingRuleType
  name: string                      // display name: "Monthly Maintenance Fee"
  amount: number                    // cents
  callTypeFilter?: string[]         // undefined = all call types; values are callType slugs
  // bucket only:
  includedMinutes?: number
  overageRate?: number              // cents per minute over bucket
  active: boolean
}

export interface BillingLineItem {
  ruleId: string
  ruleName: string
  unitDescription: string           // e.g. "47 calls × $3.50"
  subtotalCents: number
}

export interface BillingEstimate {
  businessId: string
  periodStart: string               // ISO 8601
  periodEnd: string                 // ISO 8601
  asOf: string                      // ISO 8601 — when the estimate was calculated
  totalCents: number
  callCount: number
  lineItems: BillingLineItem[]
}

export interface BillingInvoice {
  id: string
  businessId: string
  periodStart: string               // ISO 8601
  periodEnd: string                 // ISO 8601
  status: 'open' | 'closed' | 'paid'
  totalCents: number
  callCount: number
  lineItems: BillingLineItem[]
  paidAt?: string                   // ISO 8601
  createdAt: string
}
