'use client'

import { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { DashboardBillingCard } from '@/components/answering-service/DashboardBillingCard'
import { DashboardCallVolume } from '@/components/answering-service/DashboardCallVolume'
import { DashboardMessageStrip } from '@/components/answering-service/DashboardMessageStrip'
import { cardVariants } from '@/lib/design/card-system'
import { pageLayout } from '@/lib/design/spacing-system'
import { bodyStyles, headingStyles } from '@/lib/design/typography-system'
import type { DashboardSummary } from '@/types/answeringService'

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { data?: T; error?: { message?: string } }

  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message ?? 'Request failed.')
  }

  return payload.data
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className={`${cardVariants.static} p-4`}>
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-3 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-5/6" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${cardVariants.static} p-4`}>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-10 w-32" />
        </div>
        <div className={`${cardVariants.static} p-4`}>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-3 h-10 w-32" />
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
        setSummary(await parseJson<DashboardSummary>(await fetch('/api/answering-service/dashboard', { cache: 'no-store' })))
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to load dashboard.')
      } finally {
        setIsLoading(false)
      }
    }

    void loadSummary()
  }, [])

  return (
    <div className={pageLayout.container}>
      <header className="space-y-2">
        <h1 className={`${headingStyles.h1.base} text-slate-900`}>Dashboard</h1>
        <p className={`${bodyStyles.small} text-slate-600`}>
          See priority messages, this month’s billing, and call volume at a glance.
        </p>
      </header>

      {error ? (
        <div className={`${cardVariants.static} p-4`}>
          <p className={`${bodyStyles.small} text-rose-700`}>{error}</p>
        </div>
      ) : null}

      {isLoading || !summary ? (
        <DashboardSkeleton />
      ) : (
        <div className="space-y-6">
          <DashboardMessageStrip messages={summary.topUnreadMessages} totalUnreadCount={summary.unreadCount} />
          <div className="grid gap-4 lg:grid-cols-2">
            <DashboardBillingCard
              currentMonthEstimateCents={summary.currentMonthEstimate}
              callCount={summary.currentMonthCallCount}
              daysRemaining={summary.daysRemainingInPeriod}
            />
            <DashboardCallVolume
              callsThisWeek={summary.callsThisWeek}
              callsLastWeek={summary.callsLastWeek}
              callsByDay={summary.callsByDay}
            />
          </div>
        </div>
      )}
    </div>
  )
}
