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
