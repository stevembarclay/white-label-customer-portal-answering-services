import { notFound } from 'next/navigation'
import { ClientDetailTabs } from '@/components/operator/ClientDetailTabs'
import { HealthScoreBadge } from '@/components/operator/HealthScoreBadge'
import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import { getClientDetail, getClientOnCallStatus } from '@/lib/services/operator/operatorService'

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const context = await checkOperatorAccessOrThrow()
  const [client, onCallStatus] = await Promise.all([
    getClientDetail(id, context.operatorOrgId),
    getClientOnCallStatus(id),
  ])

  if (!client) notFound()

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{client.name}</h1>
        </div>
        <HealthScoreBadge
          score={client.healthBreakdown.total}
          isOverride={client.healthBreakdown.isOverride}
        />
      </div>
      <ClientDetailTabs client={client} onCallStatus={onCallStatus} />
    </div>
  )
}
