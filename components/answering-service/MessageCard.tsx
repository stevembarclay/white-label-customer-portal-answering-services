import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { cardBorderHover, cardVariants } from '@/lib/design/card-system'
import { hoverTransitions } from '@/lib/design/motion-system'
import { bodyStyles } from '@/lib/design/typography-system'
import { cn } from '@/lib/utils/cn'
import type { CallLog, MessagePriority } from '@/types/answeringService'

const PRIORITY_DOT_COLORS: Record<MessagePriority, string> = {
  high: '#ef4444',
  medium: '#f59e0b',
  low: '#94a3b8',
}

const PRIORITY_LABELS: Record<MessagePriority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

interface MessageCardProps {
  message: CallLog
  onFlagQA: (id: string) => void
  onView: (id: string) => void
  isFlaggingQA?: boolean
}

export function MessageCard({
  message,
  onFlagQA,
  onView,
  isFlaggingQA = false,
}: MessageCardProps) {
  const isFlagged = message.portalStatus === 'flagged_qa'

  return (
    <article className={cn(cardVariants.interactive, cardBorderHover.neutral, hoverTransitions.card, 'p-4')}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: PRIORITY_DOT_COLORS[message.priority] }}
              aria-hidden="true"
            />
            <span className={`${bodyStyles.caption} font-semibold text-slate-900`}>
              {PRIORITY_LABELS[message.priority]}
            </span>
            <span className={`${bodyStyles.caption} text-slate-400`}>·</span>
            <span className={`${bodyStyles.caption} text-slate-600 capitalize`}>
              {message.callType.replace(/-/g, ' ')}
            </span>
          </div>
          <h3 className="truncate text-base font-semibold text-slate-900">
            {message.callerName ?? 'Unknown caller'}
          </h3>
        </div>
        <p className={`${bodyStyles.caption} whitespace-nowrap text-slate-500`}>
          {format(new Date(message.timestamp), 'MMM d · h:mma')}
        </p>
      </div>

      <p className={`${bodyStyles.small} mt-3 line-clamp-2 text-slate-600`}>{message.message}</p>

      <div className="mt-4 flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isFlagged || isFlaggingQA}
          className="text-slate-500 hover:text-slate-800 disabled:text-slate-400"
          onClick={() => onFlagQA(message.id)}
        >
          {isFlagged ? 'Flagged' : isFlaggingQA ? 'Flagging...' : 'Flag QA'}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={() => onView(message.id)}>
          View →
        </Button>
      </div>
    </article>
  )
}
