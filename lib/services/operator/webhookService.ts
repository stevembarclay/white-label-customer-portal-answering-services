import { createHmac } from 'crypto'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'

const MAX_ATTEMPTS = 10
const FAILURE_THRESHOLD = 5

interface WebhookSubscriptionRow {
  id: string
  url: string
  secret: string
  operator_org_id: string
  status: 'active' | 'paused' | 'failing'
  consecutive_failure_count: number
}

interface RetryQueueRow {
  id: string
  subscription_id: string
  topic: string
  payload: Record<string, unknown>
  attempt_number: number
}

export function calculateNextRetryAt(attemptNumber: number, from: Date = new Date()): Date | null {
  if (attemptNumber >= MAX_ATTEMPTS) {
    return null
  }

  const delayMinutes = Math.min(2 ** (attemptNumber - 1), 60)
  return new Date(from.getTime() + delayMinutes * 60_000)
}

export function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

export async function deliverWebhook(
  subscriptionId: string,
  topic: string,
  payload: Record<string, unknown>,
  attemptNumber: number = 1
): Promise<void> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('webhook_subscriptions')
    .select('id, url, secret, operator_org_id, status, consecutive_failure_count')
    .eq('id', subscriptionId)
    .single()

  const subscription = data as WebhookSubscriptionRow | null
  if (error || !subscription || subscription.status === 'paused') {
    return
  }

  const payloadString = JSON.stringify(payload)
  const signature = signPayload(payloadString, subscription.secret)

  let responseStatus: number | null = null
  let responseBody: string | null = null
  let success = false

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(subscription.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Topic': topic,
        'X-Webhook-Attempt': String(attemptNumber),
      },
      body: payloadString,
      signal: controller.signal,
    })

    responseStatus = response.status
    responseBody = (await response.text()).slice(0, 2000)
    success = response.ok
  } catch (error) {
    logger.warn('Webhook delivery request failed', { subscriptionId, topic, attemptNumber, error })
  } finally {
    clearTimeout(timeout)
  }

  const nextRetryAt = success ? null : calculateNextRetryAt(attemptNumber)
  const isDead = !success && nextRetryAt === null

  await supabase.from('webhook_deliveries').insert({
    subscription_id: subscriptionId,
    topic,
    payload,
    response_status: responseStatus,
    response_body: responseBody,
    attempt_number: attemptNumber,
    next_retry_at: nextRetryAt?.toISOString() ?? null,
    delivered_at: success ? new Date().toISOString() : null,
  })

  if (success) {
    await supabase
      .from('webhook_subscriptions')
      .update({ consecutive_failure_count: 0, status: 'active' })
      .eq('id', subscriptionId)

    return
  }

  if (!isDead) {
    return
  }

  const newFailureCount = subscription.consecutive_failure_count + 1
  const newStatus = newFailureCount >= FAILURE_THRESHOLD ? 'failing' : subscription.status

  await supabase
    .from('webhook_subscriptions')
    .update({ consecutive_failure_count: newFailureCount, status: newStatus })
    .eq('id', subscriptionId)

  if (newStatus === 'failing') {
    logger.warn('Webhook subscription transitioned to failing', { subscriptionId, newFailureCount })
  }
}

export async function fireWebhookEvent(
  operatorOrgId: string,
  topic: string,
  payload: Record<string, unknown>
): Promise<void> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('webhook_subscriptions')
    .select('id')
    .eq('operator_org_id', operatorOrgId)
    .eq('status', 'active')
    .contains('topics', [topic])

  for (const subscription of (data ?? []) as Array<{ id: string }>) {
    void deliverWebhook(subscription.id, topic, payload, 1).catch((error) => {
      logger.error('Unhandled webhook delivery error', { subscriptionId: subscription.id, error })
    })
  }
}

export async function processRetryQueue(): Promise<void> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('webhook_deliveries')
    .select('id, subscription_id, topic, payload, attempt_number')
    .lte('next_retry_at', new Date().toISOString())
    .is('delivered_at', null)
    .limit(50)

  for (const delivery of (data ?? []) as RetryQueueRow[]) {
    await deliverWebhook(
      delivery.subscription_id,
      delivery.topic,
      delivery.payload,
      delivery.attempt_number + 1
    )

    await supabase
      .from('webhook_deliveries')
      .update({ next_retry_at: null })
      .eq('id', delivery.id)
  }
}
