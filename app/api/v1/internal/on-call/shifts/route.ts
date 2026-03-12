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
