'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { PhoneCall } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { FlagQAButton } from '@/components/answering-service/FlagQAButton'
import { PrioritySelector } from '@/components/answering-service/PrioritySelector'
import { RecordingPlayer } from '@/components/answering-service/RecordingPlayer'
import { cardVariants } from '@/lib/design/card-system'
import { cardSpacing, gridLayouts } from '@/lib/design/spacing-system'
import { badgeVariants } from '@/lib/design/color-system'
import { bodyStyles, headingStyles } from '@/lib/design/typography-system'
import type { CallLog, MessagePriority } from '@/types/answeringService'

interface MessageDetailProps {
  message: CallLog
  onRefresh?: () => Promise<void>
}

function formatDuration(durationSeconds: number): string {
  const minutes = Math.floor(durationSeconds / 60)
  const seconds = durationSeconds % 60
  return `${minutes}m ${seconds}s`
}

export function MessageDetail({ message, onRefresh }: MessageDetailProps) {
  const [priority, setPriority] = useState<MessagePriority>(message.priority)
  const [status, setStatus] = useState(message.portalStatus)

  useEffect(() => {
    if (message.portalStatus !== 'new') {
      return
    }

    void fetch(`/api/answering-service/messages/${message.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portalStatus: 'read' }),
    })
      .then(async (response) => {
        if (response.ok) {
          setStatus('read')
          await onRefresh?.()
        }
      })
      .catch(() => undefined)
  }, [message.id, message.portalStatus, onRefresh])

  return (
    <div className="space-y-4">
      <section className={`${cardVariants.static} ${cardSpacing.standalone}`}>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <PhoneCall className="h-4 w-4 text-slate-400" aria-hidden="true" />
              <p className={`${bodyStyles.caption} capitalize text-slate-500`}>
                {message.callType.replace(/-/g, ' ')}
              </p>
            </div>
            <h2 className={headingStyles.h3.base}>{message.callerName ?? 'Unknown caller'}</h2>
            <p className={`${bodyStyles.small} text-slate-500`}>
              {format(new Date(message.timestamp), 'MMMM d, yyyy · h:mma')}
            </p>
          </div>
          <PrioritySelector
            callId={message.id}
            initialPriority={priority}
            onPriorityChange={setPriority}
          />
        </div>
      </section>

      <section className={`${cardVariants.static} ${cardSpacing.standalone} space-y-3`}>
        <h3 className={headingStyles.h4.base}>Message</h3>
        <p className={`${bodyStyles.base} text-slate-700`}>{message.message}</p>
      </section>

      <RecordingPlayer recordingUrl={message.recordingUrl} />

      <section className={`${cardVariants.static} ${cardSpacing.standalone} space-y-4`}>
        <div className="flex items-center justify-between gap-3">
          <h3 className={headingStyles.h4.base}>Call details</h3>
          <FlagQAButton
            callId={message.id}
            initialStatus={status}
            onFlagged={async () => {
              setStatus('flagged_qa')
              await onRefresh?.()
            }}
          />
        </div>
        <div className={gridLayouts.twoCol}>
          <div className="space-y-1">
            <p className={`${bodyStyles.caption} text-slate-500`}>Duration</p>
            <p className={`${bodyStyles.small} text-slate-900`}>{formatDuration(message.durationSeconds)}</p>
          </div>
          <div className="space-y-1">
            <p className={`${bodyStyles.caption} text-slate-500`}>Direction</p>
            <p className={`${bodyStyles.small} capitalize text-slate-900`}>{message.direction}</p>
          </div>
          <div className="space-y-1">
            <p className={`${bodyStyles.caption} text-slate-500`}>Callback #</p>
            {message.callbackNumber ? (
              <a className={`${bodyStyles.small} text-slate-900 underline underline-offset-2`} href={`tel:${message.callbackNumber}`}>
                {message.callbackNumber}
              </a>
            ) : (
              <p className={`${bodyStyles.small} text-slate-500`}>Not provided</p>
            )}
          </div>
          <div className="space-y-1">
            <p className={`${bodyStyles.caption} text-slate-500`}>Call type</p>
            <p className={`${bodyStyles.small} capitalize text-slate-900`}>
              {message.callType.replace(/-/g, ' ')}
            </p>
          </div>
          <div className="space-y-1">
            <p className={`${bodyStyles.caption} text-slate-500`}>Portal status</p>
            <Badge className={badgeVariants.info}>{status.replace(/_/g, ' ')}</Badge>
          </div>
        </div>
      </section>
    </div>
  )
}
