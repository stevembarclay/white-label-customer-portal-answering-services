import { NextResponse } from 'next/server'
import { getBusinessContext } from '@/lib/auth/server'
import { checkModuleAccessOrThrow } from '@/lib/middleware/requireModule'
import { getMessages } from '@/lib/services/answering-service/messageService'
import { sanitizeErrorMessage } from '@/lib/utils/errorSanitizer'
import { logger } from '@/lib/utils/logger'

export async function GET() {
  try {
    const context = await getBusinessContext()

    if (!context) {
      return NextResponse.json(
        { error: { message: 'You must be signed in to access this.', code: 'UNAUTHORIZED' } },
        { status: 401 }
      )
    }

    await checkModuleAccessOrThrow('answering_service')

    const messages = await getMessages(context.businessId, context.userId)
    return NextResponse.json({ data: messages })
  } catch (error: unknown) {
    logger.error('GET /api/answering-service/messages failed', { error })
    return NextResponse.json(
      {
        error: {
          message: sanitizeErrorMessage(error),
          code: 'INTERNAL_ERROR',
        },
      },
      { status: 500 }
    )
  }
}
