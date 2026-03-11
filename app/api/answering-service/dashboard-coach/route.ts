import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import OpenAI from 'openai'
import { getBusinessContext } from '@/lib/auth/server'
import { checkModuleAccessOrThrow } from '@/lib/middleware/requireModule'
import { rateLimitAsync, createRateLimitResponse } from '@/lib/middleware/rateLimit'
import { createModuleLogger } from '@/lib/utils/logger'
import { sanitizeErrorMessage } from '@/lib/utils/errorSanitizer'
import { getCorsHeaders, getCorsPreflightHeaders } from '@/lib/utils/cors'
const logger = createModuleLogger('API')

// Runtime configuration (nodejs runtime for consistency with other AI routes)
export const runtime = 'nodejs'

/**
 * Zod schema for dashboard coach request validation
 */
const DashboardCoachRequestSchema = z.object({
  message: z.string().min(1, 'message is required'),
  conversationHistory: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })
  ).default([]),
  context: z.object({
    businessName: z.string().optional(),
    mode: z.enum(['account_support']).default('account_support'),
  }),
})

/**
 * POST /api/answering-service/dashboard-coach
 * 
 * AI Coach API route for Answering Service dashboard account support
 */
export async function POST(request: NextRequest) {
  try {
    // Authentication check - must be authenticated to use AI Coach
    const context = await getBusinessContext()
    if (!context) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    await checkModuleAccessOrThrow('answering_service')
    // Rate limiting
    const rateLimitId = context.businessId || 'anonymous'
    const rateLimitResult = await rateLimitAsync(rateLimitId)
    if (!rateLimitResult.allowed) {
      return createRateLimitResponse(rateLimitResult)
    }

    // Check for OpenAI API key
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      logger.error('[Answering Service Dashboard Coach API] Missing OPENAI_API_KEY environment variable')
      return NextResponse.json(
        { error: 'OpenAI API key not configured' },
        { status: 401 }
      )
    }

    // Parse and validate request body
    let body: unknown
    try {
      body = await request.json()
    } catch (error) {
      logger.error('[Answering Service Dashboard Coach API] Invalid JSON in request body:', error)
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }

    // Validate request schema
    const validationResult = DashboardCoachRequestSchema.safeParse(body)
    if (!validationResult.success) {
      logger.error('[Answering Service Dashboard Coach API] Validation error:', validationResult.error)
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const { message, conversationHistory, context: chatContext } = validationResult.data

    // Log request (first 100 chars only)
    const preview = message.length > 100 
      ? `${message.substring(0, 100)}...` 
      : message
    logger.info(`[Answering Service Dashboard Coach API] Message from business ${context.businessId}: ${preview}`)

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey,
    })

    // Construct system prompt for account support
    const systemPrompt = `You are an account support helper for Answering Service, a bilingual answering service.

ABOUT THIS SERVICE:
- 24/7 live answering service with bilingual (English/Spanish) agents
- Services: call answering, message taking, appointment scheduling, call patching, emergency dispatch
- Pricing: Usage-based plans starting at $39/month for 10 minutes
- No long-term contracts required
- HIPAA-compliant for medical practices
- Serves legal, medical, home services, real estate, and small businesses

CUSTOMER CONTEXT:
- Business: ${chatContext.businessName || 'Not specified'}

YOU CAN HELP WITH:
- Account questions (billing, usage, plan changes)
- Service explanations (what we do, how it works)
- Feature questions (call handling, message delivery, escalations)
- Submitting feedback or complaints
- Technical issues (portal, messages, notifications)

HOW TO HANDLE COMPLAINTS:
- Acknowledge the concern with empathy
- Ask for specific details (date, time, call ID if available)
- Explain that you'll flag this for the Customer Care team
- Offer to have someone reach out directly

RESPONSE GUIDELINES:
- Be helpful, friendly, and professional
- Keep responses concise (2-3 sentences unless detail is needed)
- If you don't know something specific to their account, say so and offer to connect them with support
- Never make up account-specific information

CONTACT INFO:
- Support email: support@example.com
- Phone: configure via NEXT_PUBLIC_SUPPORT_PHONE env var
- Hours: 24/7 for urgent issues, business hours for account changes`

    // Build conversation messages from history
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ]

    // Add conversation history
    for (const msg of conversationHistory) {
      messages.push({
        role: msg.role,
        content: msg.content,
      })
    }

    // Add current user message
    messages.push({
      role: 'user',
      content: message,
    })

    // Call OpenAI API
    let completion
    try {
      completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
        temperature: 0.7,
        messages,
        max_tokens: 500, // Keep responses concise
      })
    } catch (error) {
      // Handle OpenAI API errors
      if (error instanceof OpenAI.APIError) {
        logger.error('[Answering Service Dashboard Coach API] OpenAI API error:', {
          status: error.status,
          code: error.code,
          message: error.message,
        })

        // Handle rate limits
        if (error.status === 429) {
          return NextResponse.json(
            {
              error: 'Rate limit exceeded',
              message: 'Too many requests. Please try again later.',
            },
            { status: 429 }
          )
        }

        // Handle other API errors
        return NextResponse.json(
          {
            error: 'OpenAI API error',
            message: sanitizeErrorMessage(error),
          },
          { status: 500 }
        )
      }

      // Handle unexpected errors
      logger.error('[Answering Service Dashboard Coach API] Unexpected error calling OpenAI:', error)
      return NextResponse.json(
        {
          error: 'Failed to get coach response',
          message: sanitizeErrorMessage(error),
        },
        { status: 500 }
      )
    }

    // Extract response content
    const reply = completion.choices[0]?.message?.content
    if (!reply) {
      logger.error('[Answering Service Dashboard Coach API] No content in OpenAI response')
      return NextResponse.json(
        { error: 'No response from AI coach' },
        { status: 500 }
      )
    }

    // Log response (first 100 chars)
    const replyPreview = reply.length > 100 ? `${reply.substring(0, 100)}...` : reply
    logger.info(`[Answering Service Dashboard Coach API] Response: ${replyPreview}`)

    // Return successful response with CORS headers
    const origin = request.headers.get('origin')
    return NextResponse.json(
      {
        reply,
      },
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ...getCorsHeaders(origin),
        },
      }
    )
  } catch (error) {
    // Catch any unexpected errors
    logger.error('[Answering Service Dashboard Coach API] Unexpected error:', error)
    return NextResponse.json(
      {
        error: 'Internal server error',
        message: sanitizeErrorMessage(error),
      },
      { status: 500 }
    )
  }
}

/**
 * OPTIONS handler for CORS preflight requests
 */
export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin')
  return NextResponse.json({}, { status: 200, headers: getCorsPreflightHeaders(origin) })
}


