import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { ClientDetailTabs } from '@/components/operator/ClientDetailTabs'
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
    getClientOnCallStatus(id, context.operatorOrgId),
  ])

  if (!client) notFound()

  return (
    <div className="flex h-full flex-col">
      {/* Top bar with breadcrumb */}
      <div className="flex h-16 shrink-0 items-center border-b border-border bg-card px-8">
        <div className="flex items-center gap-1.5">
          <Link
            href="/operator/clients"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Clients
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-sm font-semibold text-foreground">{client.name}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        <ClientDetailTabs client={client} onCallStatus={onCallStatus} />
      </div>
    </div>
  )
}
