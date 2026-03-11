import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/utils/logger'
import type {
  CallLog,
  MessageAction,
  MessagePriority,
  PortalStatus,
  TelephonyStatus,
} from '@/types/answeringService'

interface MessageActionRow {
  id: string
  type: MessageAction['type']
  by_user_id: string
  at: string
  from_value: string | null
  to_value: string | null
}

interface CallLogRow {
  id: string
  business_id: string
  timestamp: string
  caller_name: string | null
  caller_number: string | null
  callback_number: string | null
  call_type: string
  direction: CallLog['direction']
  duration_seconds: number
  telephony_status: TelephonyStatus
  message: string
  has_recording: boolean
  priority: MessagePriority
  portal_status: PortalStatus
  message_actions: MessageActionRow[] | null
}

function mapActionRow(row: MessageActionRow): MessageAction {
  if (row.type === 'priority_updated') {
    return {
      id: row.id,
      type: row.type,
      by: row.by_user_id,
      at: row.at,
      from: (row.from_value ?? 'low') as MessagePriority,
      to: (row.to_value ?? 'low') as MessagePriority,
    }
  }

  if (row.type === 'status_changed') {
    return {
      id: row.id,
      type: row.type,
      by: row.by_user_id,
      at: row.at,
      from: (row.from_value ?? 'new') as PortalStatus,
      to: (row.to_value ?? 'new') as PortalStatus,
    }
  }

  return {
    id: row.id,
    type: 'flagged_qa',
    by: row.by_user_id,
    at: row.at,
  }
}

function mapCallLogRow(row: CallLogRow, lastLoginAt: string | null): CallLog {
  return {
    id: row.id,
    businessId: row.business_id,
    timestamp: row.timestamp,
    callerName: row.caller_name ?? undefined,
    callerNumber: row.caller_number ?? undefined,
    callbackNumber: row.callback_number ?? undefined,
    callType: row.call_type,
    direction: row.direction,
    durationSeconds: row.duration_seconds,
    telephonyStatus: row.telephony_status,
    message: row.message,
    priority: row.priority,
    portalStatus: row.portal_status,
    actions: (row.message_actions ?? []).map(mapActionRow),
    isNew: lastLoginAt ? row.timestamp > lastLoginAt : true,
  }
}

export async function getMessages(businessId: string, userId: string): Promise<CallLog[]> {
  const supabase = await createClient()

  const { data: membership, error: membershipError } = await supabase
    .from('users_businesses')
    .select('last_login_at')
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .single()

  if (membershipError) {
    throw new Error('Could not determine message freshness for this user.')
  }

  const lastLoginAt = membership?.last_login_at ?? null

  const { data, error } = await supabase
    .from('call_logs')
    .select(
      `id, business_id, timestamp, caller_name, caller_number, callback_number, call_type,
       direction, duration_seconds, telephony_status, message, has_recording, priority,
       portal_status, message_actions (id, type, by_user_id, at, from_value, to_value)`
    )
    .eq('business_id', businessId)
    .order('timestamp', { ascending: false })

  if (error) {
    throw new Error('Failed to load messages.')
  }

  const priorityOrder: Record<MessagePriority, number> = { high: 0, medium: 1, low: 2 }
  // SAFETY: This query selects the exact CallLogRow shape declared above.
  const rows = (data ?? []) as CallLogRow[]

  const messages = rows
    .map((row) => mapCallLogRow(row, lastLoginAt))
    .sort((left, right) => {
      const priorityDiff = priorityOrder[left.priority] - priorityOrder[right.priority]
      return priorityDiff !== 0 ? priorityDiff : right.timestamp.localeCompare(left.timestamp)
    })

  void (async () => {
    try {
      await supabase
        .from('users_businesses')
        .update({ last_login_at: new Date().toISOString() })
        .eq('business_id', businessId)
        .eq('user_id', userId)
    } catch (updateError: unknown) {
      logger.error('Failed to update last_login_at after message load', {
        businessId,
        userId,
        error: updateError,
      })
    }
  })()

  return messages
}

export async function getMessage(id: string, businessId: string): Promise<CallLog | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('call_logs')
    .select(
      `id, business_id, timestamp, caller_name, caller_number, callback_number, call_type,
       direction, duration_seconds, telephony_status, message, has_recording, priority,
       portal_status, message_actions (id, type, by_user_id, at, from_value, to_value)`
    )
    .eq('id', id)
    .eq('business_id', businessId)
    .single()

  if (error || !data) {
    return null
  }

  // SAFETY: This query selects the exact CallLogRow shape declared above.
  const row = data as CallLogRow
  const message = mapCallLogRow(row, null)

  if (row.has_recording) {
    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('call-recordings')
      .createSignedUrl(`${businessId}/${id}.mp3`, 3600)

    if (!signedUrlError && signedUrlData?.signedUrl) {
      message.recordingUrl = signedUrlData.signedUrl
    }
  }

  return message
}

export async function updatePriority(
  id: string,
  businessId: string,
  userId: string,
  priority: MessagePriority
): Promise<void> {
  const supabase = await createClient()

  const { data: current, error: currentError } = await supabase
    .from('call_logs')
    .select('priority')
    .eq('id', id)
    .eq('business_id', businessId)
    .single()

  if (currentError || !current) {
    throw new Error('Message not found.')
  }

  const currentPriority = current.priority as MessagePriority

  if (currentPriority === priority) {
    return
  }

  const { error: updateError } = await supabase
    .from('call_logs')
    .update({ priority })
    .eq('id', id)
    .eq('business_id', businessId)

  if (updateError) {
    throw new Error('Failed to update priority.')
  }

  const { error: insertError } = await supabase.from('message_actions').insert({
    call_log_id: id,
    business_id: businessId,
    type: 'priority_updated',
    by_user_id: userId,
    at: new Date().toISOString(),
    from_value: currentPriority,
    to_value: priority,
  })

  if (insertError) {
    throw new Error('Priority updated, but the audit log could not be written.')
  }
}

export async function flagQA(id: string, businessId: string, userId: string): Promise<void> {
  const supabase = await createClient()

  const { data: current, error: currentError } = await supabase
    .from('call_logs')
    .select('portal_status')
    .eq('id', id)
    .eq('business_id', businessId)
    .single()

  if (currentError || !current) {
    throw new Error('Message not found.')
  }

  if ((current.portal_status as PortalStatus) === 'flagged_qa') {
    return
  }

  const { error: updateError } = await supabase
    .from('call_logs')
    .update({ portal_status: 'flagged_qa' })
    .eq('id', id)
    .eq('business_id', businessId)

  if (updateError) {
    throw new Error('Failed to flag message for QA.')
  }

  const { error: insertError } = await supabase.from('message_actions').insert({
    call_log_id: id,
    business_id: businessId,
    type: 'flagged_qa',
    by_user_id: userId,
    at: new Date().toISOString(),
  })

  if (insertError) {
    throw new Error('Message flagged, but the audit log could not be written.')
  }
}

export async function markRead(id: string, businessId: string): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase
    .from('call_logs')
    .update({ portal_status: 'read' })
    .eq('id', id)
    .eq('business_id', businessId)
    .eq('portal_status', 'new')

  if (error) {
    throw new Error('Failed to update read status.')
  }
}
