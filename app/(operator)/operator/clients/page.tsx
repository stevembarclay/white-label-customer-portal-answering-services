import { Search } from 'lucide-react'
import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import { getClientsWithHealthScores } from '@/lib/services/operator/operatorService'
import { ClientTable } from '@/components/operator/ClientTable'

export default async function ClientsPage() {
  const context = await checkOperatorAccessOrThrow()
  const clients = await getClientsWithHealthScores(context.operatorOrgId)

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-8">
        <h1 className="text-xl font-bold text-foreground">Clients</h1>
        <div className="flex h-9 w-[280px] items-center gap-2 rounded-lg bg-muted px-3">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="text-[13px] text-muted-foreground">Search clients…</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        <ClientTable clients={clients} />
      </div>
    </div>
  )
}
