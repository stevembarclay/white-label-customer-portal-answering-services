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
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const context = await getBusinessContext()
  if (!context) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  await deleteContact(id, context.businessId)
  return NextResponse.json({ ok: true })
}
