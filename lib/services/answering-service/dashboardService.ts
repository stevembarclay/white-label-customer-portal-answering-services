import { createClient } from '@/lib/supabase/server'
import { getCurrentEstimate } from '@/lib/services/answering-service/billingService'
import type { CallLog, DashboardSummary, DayCount, MessagePriority } from '@/types/answeringService'

interface TopMessageRow {
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

function mapTopMessage(row: TopMessageRow): CallLog {
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
    isNew: true,
  }
}

export async function getUnreadMessageCount(businessId: string): Promise<number> {
  const supabase = await createClient()
  const { count } = await supabase
    .from('call_logs')
    .select('id', { count: 'exact', head: true })
    .eq('business_id', businessId)
    .eq('portal_status', 'new')

  return count ?? 0
}

export async function getDashboardSummary(businessId: string, _userId: string): Promise<DashboardSummary> {
  const supabase = await createClient()
  const now = new Date()
  const startOfThisWeek = new Date(now)
  startOfThisWeek.setUTCHours(0, 0, 0, 0)
  startOfThisWeek.setUTCDate(now.getUTCDate() - now.getUTCDay())

  const startOfLastWeek = new Date(startOfThisWeek)
  startOfLastWeek.setUTCDate(startOfLastWeek.getUTCDate() - 7)

  const endOfLastWeek = new Date(startOfThisWeek)
  endOfLastWeek.setUTCMilliseconds(-1)

  const sevenDaysAgo = new Date(now)
  sevenDaysAgo.setUTCDate(now.getUTCDate() - 6)
  sevenDaysAgo.setUTCHours(0, 0, 0, 0)

  const [
    topUnreadResult,
    unreadCountResult,
    thisWeekResult,
    lastWeekResult,
    sevenDayResult,
    estimateResult,
  ] = await Promise.allSettled([
    supabase
      .from('call_logs')
      .select(
        'id, business_id, timestamp, caller_name, caller_number, callback_number, call_type, direction, duration_seconds, telephony_status, message, priority, portal_status'
      )
      .eq('business_id', businessId)
      .eq('portal_status', 'new')
      .in('priority', ['high', 'medium'])
      .order('timestamp', { ascending: false })
      .limit(10),
    supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .eq('portal_status', 'new'),
    supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .gte('timestamp', startOfThisWeek.toISOString()),
    supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .gte('timestamp', startOfLastWeek.toISOString())
      .lte('timestamp', endOfLastWeek.toISOString()),
    supabase
      .from('call_logs')
      .select('timestamp')
      .eq('business_id', businessId)
      .gte('timestamp', sevenDaysAgo.toISOString()),
    getCurrentEstimate(businessId),
  ])

  const priorityOrder: Record<MessagePriority, number> = { high: 0, medium: 1, low: 2 }
  const topUnreadMessages =
    topUnreadResult.status === 'fulfilled'
      ? // SAFETY: This query selects the exact TopMessageRow shape declared above.
        ((topUnreadResult.value.data ?? []) as TopMessageRow[])
          .map(mapTopMessage)
          .sort((left, right) => {
            const diff = priorityOrder[left.priority] - priorityOrder[right.priority]
            return diff !== 0 ? diff : right.timestamp.localeCompare(left.timestamp)
          })
          .slice(0, 3)
      : []

  const callsByDay: DayCount[] = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(sevenDaysAgo)
    date.setUTCDate(sevenDaysAgo.getUTCDate() + index)
    return {
      date: date.toISOString().slice(0, 10),
      count: 0,
    }
  })

  if (sevenDayResult.status === 'fulfilled') {
    const rows = (sevenDayResult.value.data ?? []) as Array<{ timestamp: string }>
    for (const row of rows) {
      const day = callsByDay.find((item) => item.date === row.timestamp.slice(0, 10))
      if (day) {
        day.count += 1
      }
    }
  }

  const estimate = estimateResult.status === 'fulfilled' ? estimateResult.value : null
  const lastDayOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))

  return {
    callsThisWeek: thisWeekResult.status === 'fulfilled' ? thisWeekResult.value.count ?? 0 : 0,
    callsLastWeek: lastWeekResult.status === 'fulfilled' ? lastWeekResult.value.count ?? 0 : 0,
    callsByDay,
    unreadCount: unreadCountResult.status === 'fulfilled' ? unreadCountResult.value.count ?? 0 : 0,
    currentMonthEstimate: estimate?.totalCents ?? 0,
    currentMonthCallCount: estimate?.callCount ?? 0,
    daysRemainingInPeriod: lastDayOfMonth.getUTCDate() - now.getUTCDate() + 1,
    topUnreadMessages,
  }
}
