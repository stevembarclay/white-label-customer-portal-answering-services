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
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await getBusinessContext()
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  await deleteShift(id, context.businessId)
  return NextResponse.json({ ok: true })
}
