import { NextRequest, NextResponse } from 'next/server'

import { validateBearerToken } from '@/lib/api/bearerAuth'
import { createClient } from '@/lib/supabase/server'
import { sanitizeErrorMessage } from '@/lib/utils/errorSanitizer'
import { logger } from '@/lib/utils/logger'

export async function GET(request: NextRequest) {
  try {
    const auth = await validateBearerToken(
      request.headers.get('authorization'),
      'calls:read',
      request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '0.0.0.0'
    )
    if (!auth.valid) {
      return NextResponse.json({ error: { message: auth.message, code: 'UNAUTHORIZED' } }, { status: auth.status })
    }

    const url = new URL(request.url)
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') ?? '1', 10))
    const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '25', 10)))
    const offset = (page - 1) * limit

    if (auth.operatorOrgId && !url.searchParams.get('business_id')) {
      return NextResponse.json(
        { error: { message: 'business_id query parameter is required for operator keys.', code: 'BAD_REQUEST' } },
        { status: 400 }
      )
    }

    const businessId = auth.businessId ?? url.searchParams.get('business_id')
    if (!businessId) {
      return NextResponse.json({ error: { message: 'Business not found.', code: 'NOT_FOUND' } }, { status: 404 })
    }

    const supabase = await createClient()

    if (auth.operatorOrgId) {
      const { data: business } = await supabase
        .from('businesses')
        .select('id')
        .eq('id', businessId)
        .eq('operator_org_id', auth.operatorOrgId)
        .maybeSingle()

      if (!business) {
        return NextResponse.json(
          { error: { message: 'Business not found or not in your org.', code: 'NOT_FOUND' } },
          { status: 404 }
        )
      }
    }

    const { data, count, error } = await supabase
      .from('call_logs')
      .select(
        'id, business_id, timestamp, call_type, direction, duration_seconds, telephony_status, message, priority, portal_status',
        { count: 'exact' }
      )
      .eq('business_id', businessId)
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      throw error
    }

    return NextResponse.json({
      data,
      meta: { page, limit, total: count ?? 0 },
    })
  } catch (error) {
    logger.error('GET /api/v1/calls failed', { error })
    return NextResponse.json({ error: { message: sanitizeErrorMessage(error), code: 'INTERNAL_ERROR' } }, { status: 500 })
  }
}
