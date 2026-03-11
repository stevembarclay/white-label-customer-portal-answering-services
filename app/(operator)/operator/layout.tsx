import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'
import { OperatorNav } from '@/components/operator/OperatorNav'

export default async function OperatorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const context = await checkOperatorAccessOrThrow()

  const supabase = await createClient()
  const { data: org } = await supabase
    .from('operator_orgs')
    .select('name')
    .eq('id', context.operatorOrgId)
    .single()

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6 md:px-6">
        <OperatorNav orgName={org?.name ?? 'Operator'} />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
