import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import { getClientsWithHealthScores } from '@/lib/services/operator/operatorService'
import { ClientTable } from '@/components/operator/ClientTable'

export default async function ClientsPage() {
  const context = await checkOperatorAccessOrThrow()
  const clients = await getClientsWithHealthScores(context.operatorOrgId)

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Clients</h1>
      <ClientTable clients={clients} />
    </div>
  )
}
