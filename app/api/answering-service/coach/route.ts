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
 * Zod schema for coach request validation
 */
const CoachRequestSchema = z.object({
  message: z.string().min(1, 'message is required'),
  conversationHistory: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })
  ).default([]),
  wizardContext: z.object({
    currentStep: z.number().min(0).max(10),
    stepName: z.string().min(1, 'stepName is required'),
    industry: z.string().optional(),
    businessName: z.string().optional(),
    formData: z.record(z.unknown()).optional(),
  }),
})

/**
 * POST /api/answering-service/coach
 * 
 * AI Coach API route for Answering Service setup wizard guidance
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
      logger.error('[Answering Service Coach API] Missing OPENAI_API_KEY environment variable')
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
      logger.error('[Answering Service Coach API] Invalid JSON in request body:', error)
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }

    // Validate request schema
    const validationResult = CoachRequestSchema.safeParse(body)
    if (!validationResult.success) {
      logger.error('[Answering Service Coach API] Validation error:', validationResult.error)
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: validationResult.error.errors,
        },
        { status: 400 }
      )
    }

    const { message, conversationHistory, wizardContext } = validationResult.data

    // Log request (first 100 chars only)
    const preview = message.length > 100 
      ? `${message.substring(0, 100)}...` 
      : message
    logger.info(`[Answering Service Coach API] Message for step ${wizardContext.currentStep + 1} (${wizardContext.stepName}): ${preview}`)

    // Initialize OpenAI client
    const openai = new OpenAI({
      apiKey,
    })

    // Construct system prompt with wizard context
    const systemPrompt = `You are an onboarding coach for Answering Service, a bilingual answering service. You're helping a customer configure their account through a setup wizard.

CURRENT CONTEXT:
- Step: ${wizardContext.stepName} (${wizardContext.currentStep + 1} of 7)
- Industry: ${wizardContext.industry || 'Not yet selected'}
- Business: ${wizardContext.businessName || 'Not yet provided'}

YOUR ROLE:
- Answer questions about the current step
- Explain answering service concepts in plain language
- Give industry-specific advice when relevant
- Keep responses concise (2-3 sentences unless they ask for detail)
- Never make changes to their account - only advise

KEY DEFINITIONS (use when explaining):
- "Patch" or "Patch Through": Transfer the call directly to the customer
- "Screen and Patch": Ask qualifying questions, then transfer if criteria met
- "Take Message": Collect caller info and message, deliver via email/SMS
- "Escalation": Urgent situation requiring immediate contact (e.g., wake someone up)
- "Business Hours Handling": What happens during open hours
- "After Hours Handling": What happens when closed

INDUSTRY-SPECIFIC GUIDANCE:
- Legal: New client intake is critical, conflicts checks matter, court deadlines are emergencies
- Medical: HIPAA compliance, never give medical advice, patient emergencies need clear escalation
- Home Services: After-hours emergencies (no heat, flooding) are common, dispatch protocols matter
- Real Estate: Hot leads need immediate response, showing requests are time-sensitive

PROACTIVE GUIDANCE:
When responding, watch for these signals and respond appropriately:

1. CONFUSION SIGNALS (user asks same thing multiple ways, says "I don't understand"):
   - Answer their question clearly first
   - Then add: "If you'd like to talk this through with someone, you can schedule a call anytime."

2. UNCERTAINTY SIGNALS (user says "I'm not sure", "I don't know", "maybe"):
   - Provide your best recommendation based on their industry
   - Then add: "Don't worry about getting this perfect — you can always adjust after your account is built, or schedule a review call."

3. COMPLEXITY SIGNALS (user asks about edge cases, multiple scenarios):
   - Answer what you can
   - Then add: "This is a great question for a setup call — they can walk through your specific scenarios."

4. FRICTION SIGNALS (user expresses frustration, says "this is confusing"):
   - Acknowledge the frustration briefly
   - Offer to simplify: "Let me break this down differently..."
   - End with: "Or if you'd prefer, you can schedule a call and we'll handle the setup together."

Keep these suggestions natural and occasional — don't add them to every response. Only when the signals are clear.

Be helpful, professional, and conversational. If they ask something outside your scope, say so politely.`

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
        logger.error('[Answering Service Coach API] OpenAI API error:', {
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
      logger.error('[Answering Service Coach API] Unexpected error calling OpenAI:', error)
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
      logger.error('[Answering Service Coach API] No content in OpenAI response')
      return NextResponse.json(
        { error: 'No response from AI coach' },
        { status: 500 }
      )
    }

    // Log response (first 100 chars)
    const replyPreview = reply.length > 100 ? `${reply.substring(0, 100)}...` : reply
    logger.info(`[Answering Service Coach API] Response: ${replyPreview}`)

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
    logger.error('[Answering Service Coach API] Unexpected error:', error)
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

