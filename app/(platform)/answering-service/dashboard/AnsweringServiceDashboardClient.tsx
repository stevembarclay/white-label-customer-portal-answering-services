'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Phone, Receipt, TrendingDown, TrendingUp } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import type { DashboardSummary } from '@/types/answeringService'

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { data?: T; error?: { message?: string } }

  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message ?? 'Request failed.')
  }

  return payload.data
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return `Today, ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <div className="rounded-xl border border-border bg-card p-5">
        <Skeleton className="h-4 w-40 mb-4" />
        <Skeleton className="h-14 w-full mb-2" />
        <Skeleton className="h-14 w-full" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <Skeleton className="h-3 w-28 mb-3" />
          <Skeleton className="h-10 w-24 mb-3" />
          <Skeleton className="h-3 w-40" />
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <Skeleton className="h-3 w-28 mb-3" />
          <Skeleton className="h-10 w-16 mb-3" />
          <Skeleton className="h-3 w-36" />
        </div>
      </div>
    </div>
  )
}

export default function AnsweringServiceDashboardClient() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadSummary() {
      setIsLoading(true)
      setError(null)

      try {
        setSummary(
          await parseJson<DashboardSummary>(
            await fetch('/api/answering-service/dashboard', { cache: 'no-store' })
          )
        )
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to load dashboard.')
      } finally {
        setIsLoading(false)
      }
    }

    void loadSummary()
  }, [])

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Priority messages, this month&apos;s billing, and call volume at a glance.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-4">
          <p className="text-sm text-rose-700">{error}</p>
        </div>
      ) : null}

      {isLoading || !summary ? (
        <DashboardSkeleton />
      ) : (
        <>
          {/* Priority Messages card */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex h-[52px] items-center justify-between border-b border-border px-5">
              <span className="text-sm font-semibold text-foreground">Priority Messages</span>
              {summary.unreadCount > 0 ? (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">
                  {summary.unreadCount} unread
                </span>
              ) : null}
            </div>

            {summary.topUnreadMessages.map((msg) => (
              <div
                key={msg.id}
                className="flex h-14 items-center gap-3 border-b border-border px-5"
              >
                <div className="h-2 w-2 shrink-0 rounded-full bg-info" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-foreground">
                    {msg.callerNumber ?? 'Unknown'} — {msg.message}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatTimestamp(msg.timestamp)}</p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            ))}

            <Link
              href="/answering-service/messages"
              className="flex h-11 items-center px-5 text-[13px] text-primary hover:underline"
            >
              View all {summary.unreadCount} unread messages →
            </Link>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* Billing card */}
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-muted-foreground">
                  This Month (est.)
                </span>
                <Receipt className="h-4 w-4 text-muted-foreground" />
              </div>
              <span className="text-[32px] font-bold leading-none text-foreground">
                {formatCents(summary.currentMonthEstimate)}
              </span>
              <div className="flex items-center gap-3">
                <span className="text-[13px] text-muted-foreground">
                  {summary.currentMonthCallCount} calls
                </span>
                <div className="h-1 w-1 rounded-full bg-border" />
                <span className="text-[13px] text-muted-foreground">
                  {summary.daysRemainingInPeriod} days remaining
                </span>
              </div>
            </div>

            {/* Calls card */}
            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold text-muted-foreground">
                  Calls This Week
                </span>
                <Phone className="h-4 w-4 text-muted-foreground" />
              </div>
              <span className="text-[32px] font-bold leading-none text-foreground">
                {summary.callsThisWeek}
              </span>
              {(() => {
                const diff = summary.callsThisWeek - summary.callsLastWeek
                const isUp = diff >= 0
                const TrendIcon = isUp ? TrendingUp : TrendingDown
                return (
                  <div className="flex items-center gap-1.5">
                    <TrendIcon
                      className={`h-3.5 w-3.5 ${isUp ? 'text-success' : 'text-destructive'}`}
                    />
                    <span
                      className={`text-[13px] ${isUp ? 'text-success' : 'text-destructive'}`}
                    >
                      {isUp ? '+' : ''}
                      {diff} from last week
                    </span>
                  </div>
                )
              })()}

              {/* Bar chart */}
              {summary.callsByDay.length > 0 ? (
                <div className="flex h-10 items-end gap-1">
                  {summary.callsByDay.map((day, i) => {
                    const max = Math.max(...summary.callsByDay.map((d) => d.count), 1)
                    const pct = day.count / max
                    const heightPx = Math.max(4, Math.round(pct * 40))
                    const isLast = i === summary.callsByDay.length - 1
                    return (
                      <div
                        key={day.date}
                        style={{ height: `${heightPx}px` }}
                        className={`flex-1 rounded-sm ${isLast ? 'bg-primary' : 'bg-muted'}`}
                      />
                    )
                  })}
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
