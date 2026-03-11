import { createClient } from '@/lib/supabase/server'
import { calculateEstimate } from '@/lib/services/answering-service/billingEngine'
import type { BillingEstimate, BillingInvoice, BillingRule, CallLog } from '@/types/answeringService'

interface BillingRuleRow {
  id: string
  business_id: string
  type: BillingRule['type']
  name: string
  amount: number
  call_type_filter: string[] | null
  included_minutes: number | null
  overage_rate: number | null
  active: boolean
}

interface CallLogRow {
  id: string
  business_id: string
  timestamp: string
  caller_name: string | null
  caller_number: string | null
  callback_number: string | null
  call_type: string
  direction: CallLog['direction']
  duration_seconds: number
  telephony_status: CallLog['telephonyStatus']
  message: string
  priority: CallLog['priority']
  portal_status: CallLog['portalStatus']
}

interface BillingPeriodRow {
  id: string
  business_id: string
  period_start: string
  period_end: string
  status: BillingInvoice['status']
  total_cents: number
  call_count: number
  line_items: BillingInvoice['lineItems'] | null
  paid_at: string | null
  created_at: string
}

function mapRule(row: BillingRuleRow): BillingRule {
  return {
    id: row.id,
    businessId: row.business_id,
    type: row.type,
    name: row.name,
    amount: row.amount,
    callTypeFilter: row.call_type_filter ?? undefined,
    includedMinutes: row.included_minutes ?? undefined,
    overageRate: row.overage_rate ?? undefined,
    active: row.active,
  }
}

function mapCall(row: CallLogRow): CallLog {
  return {
    id: row.id,
    businessId: row.business_id,
    timestamp: row.timestamp,
    callerName: row.caller_name ?? undefined,
    callerNumber: row.caller_number ?? undefined,
    callbackNumber: row.callback_number ?? undefined,
    callType: row.call_type,
    direction: row.direction,
    durationSeconds: row.duration_seconds,
    telephonyStatus: row.telephony_status,
    message: row.message,
    priority: row.priority,
    portalStatus: row.portal_status,
    actions: [],
    isNew: false,
  }
}

function mapInvoice(row: BillingPeriodRow): BillingInvoice {
  return {
    id: row.id,
    businessId: row.business_id,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    status: row.status,
    totalCents: row.total_cents,
    callCount: row.call_count,
    lineItems: row.line_items ?? [],
    paidAt: row.paid_at ?? undefined,
    createdAt: row.created_at,
  }
}

function getCurrentPeriod(): { start: Date; end: Date } {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59))
  return { start, end }
}

export async function getBillingRules(businessId: string): Promise<BillingRule[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('billing_rules')
    .select('id, business_id, type, name, amount, call_type_filter, included_minutes, overage_rate, active')
    .eq('business_id', businessId)
    .eq('active', true)
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error('Failed to load billing rules.')
  }

  // SAFETY: This query selects the exact BillingRuleRow shape declared above.
  return ((data ?? []) as BillingRuleRow[]).map(mapRule)
}

export async function getCurrentEstimate(businessId: string): Promise<BillingEstimate> {
  const supabase = await createClient()
  const period = getCurrentPeriod()
  const [rules, callsResult, businessResult] = await Promise.all([
    getBillingRules(businessId),
    supabase
      .from('call_logs')
      .select(
        'id, business_id, timestamp, caller_name, caller_number, callback_number, call_type, direction, duration_seconds, telephony_status, message, priority, portal_status'
      )
      .eq('business_id', businessId)
      .gte('timestamp', period.start.toISOString())
      .lte('timestamp', period.end.toISOString()),
    supabase.from('businesses').select('created_at').eq('id', businessId).maybeSingle(),
  ])

  if (callsResult.error) {
    throw new Error('Failed to load calls for the billing estimate.')
  }

  if (businessResult.error) {
    throw new Error('Failed to load business billing context.')
  }

  // SAFETY: Local DB types stub omits businesses.created_at, but the live schema provides it per Plan A.
  const businessCreatedAt =
    new Date((businessResult.data as { created_at?: string } | null)?.created_at ?? period.start.toISOString())

  // SAFETY: This query selects the exact CallLogRow shape declared above.
  const calls = ((callsResult.data ?? []) as CallLogRow[]).map(mapCall)

  return calculateEstimate(businessId, rules, calls, period, businessCreatedAt)
}

export async function getPastInvoices(businessId: string): Promise<BillingInvoice[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('billing_periods')
    .select('id, business_id, period_start, period_end, status, total_cents, call_count, line_items, paid_at, created_at')
    .eq('business_id', businessId)
    .in('status', ['closed', 'paid'])
    .order('period_start', { ascending: false })

  if (error) {
    throw new Error('Failed to load past invoices.')
  }

  // SAFETY: This query selects the exact BillingPeriodRow shape declared above.
  return ((data ?? []) as BillingPeriodRow[]).map(mapInvoice)
}

export async function getInvoiceDetail(id: string, businessId: string): Promise<BillingInvoice | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('billing_periods')
    .select('id, business_id, period_start, period_end, status, total_cents, call_count, line_items, paid_at, created_at')
    .eq('id', id)
    .eq('business_id', businessId)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  // SAFETY: This query selects the exact BillingPeriodRow shape declared above.
  return mapInvoice(data as BillingPeriodRow)
}
