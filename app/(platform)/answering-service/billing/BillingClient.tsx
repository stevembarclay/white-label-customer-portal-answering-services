'use client'

import { useState, useEffect } from 'react'
import { PastInvoicesList } from '@/components/answering-service/PastInvoicesList'
import { InvoiceDetailModal } from '@/components/answering-service/InvoiceDetailModal'
import { RunningEstimateCard } from '@/components/answering-service/RunningEstimateCard'
import { Skeleton } from '@/components/ui/skeleton'
import { cardVariants } from '@/lib/design/card-system'
import { pageLayout } from '@/lib/design/spacing-system'
import { bodyStyles, headingStyles } from '@/lib/design/typography-system'
import type { BillingEstimate, BillingInvoice } from '@/types/answeringService'

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { data?: T; error?: { message?: string } }

  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message ?? 'Request failed.')
  }

  return payload.data
}

function BillingCardSkeleton() {
  return (
    <div className={`${cardVariants.static} space-y-4 p-6`} aria-hidden="true">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-14 w-48" />
      <Skeleton className="h-2 w-full" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  )
}

export default function BillingClient() {
  const [estimate, setEstimate] = useState<BillingEstimate | null>(null)
  const [invoices, setInvoices] = useState<BillingInvoice[]>([])
  const [isEstimateLoading, setIsEstimateLoading] = useState(true)
  const [isInvoicesLoading, setIsInvoicesLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedInvoice, setSelectedInvoice] = useState<BillingInvoice | null>(null)

  useEffect(() => {
    async function loadEstimate() {
      setIsEstimateLoading(true)
      try {
        setEstimate(
          await parseJson<BillingEstimate>(
            await fetch('/api/answering-service/billing/estimate', { cache: 'no-store' })
          )
        )
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to load billing estimate.')
      } finally {
        setIsEstimateLoading(false)
      }
    }

    async function loadInvoices() {
      setIsInvoicesLoading(true)
      try {
        setInvoices(
          await parseJson<BillingInvoice[]>(
            await fetch('/api/answering-service/billing/invoices', { cache: 'no-store' })
          )
        )
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : 'Failed to load invoices.')
      } finally {
        setIsInvoicesLoading(false)
      }
    }

    setError(null)
    void loadEstimate()
    void loadInvoices()
  }, [])

  if (error) {
    return (
      <div className={pageLayout.container}>
        <div className="space-y-2">
          <h1 className={`${headingStyles.h1.base} text-slate-900`}>Billing</h1>
          <p className={`${bodyStyles.small} text-slate-600`}>
            View your running estimate and finalized invoices.
          </p>
        </div>
        <div className={`${cardVariants.static} p-4`}>
          <p className={`${bodyStyles.small} text-rose-700`}>{error}</p>
        </div>
      </div>
    )
  }

  const priorMonthTotal = invoices[0]?.totalCents

  return (
    <div className={pageLayout.container}>
      <div className="space-y-2">
        <h1 className={`${headingStyles.h1.base} text-slate-900`}>Billing</h1>
        <p className={`${bodyStyles.small} text-slate-600`}>
          Running estimate first, finalized invoices below.
        </p>
      </div>

      {isEstimateLoading || !estimate ? (
        <BillingCardSkeleton />
      ) : (
        <RunningEstimateCard estimate={estimate} priorMonthTotalCents={priorMonthTotal} />
      )}

      {isInvoicesLoading ? (
        <BillingCardSkeleton />
      ) : (
        <PastInvoicesList invoices={invoices} onSelectInvoice={setSelectedInvoice} />
      )}

      <InvoiceDetailModal invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />
    </div>
  )
}
