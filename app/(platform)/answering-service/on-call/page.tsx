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
  let current = null
  try {
    current = resolveActiveShift(now, effectiveTimezone, schedulerShifts, contactMap)
  } catch {
    // Invalid stored timezone: degrade gracefully rather than crashing the page
  }

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
