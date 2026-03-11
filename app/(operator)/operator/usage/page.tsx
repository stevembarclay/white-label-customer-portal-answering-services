import { CallUploadPanel } from '@/components/operator/CallUploadPanel'
import { UsageHistory } from '@/components/operator/UsageHistory'
import { UsageUploadPanel } from '@/components/operator/UsageUploadPanel'
import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'

export default async function UsagePage() {
  const context = await checkOperatorAccessOrThrow()
  const supabase = await createClient()

  const { data: history } = await supabase
    .from('usage_periods')
    .select('id, business_id, period_date, total_calls, total_minutes, source, status, error_detail, created_at')
    .eq('operator_org_id', context.operatorOrgId)
    .order('created_at', { ascending: false })
    .limit(30)

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Usage Ingest</h1>

      <section>
        <h2 className="mb-4 text-base font-semibold">Upload CSV</h2>
        {context.role === 'admin' ? (
          <UsageUploadPanel />
        ) : (
          <p className="text-sm text-slate-400">Admin role required to upload usage data.</p>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-base font-semibold">Upload Call Logs</h2>
        {context.role === 'admin' ? (
          <CallUploadPanel />
        ) : (
          <p className="text-sm text-slate-400">Admin role required to upload call logs.</p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-6 opacity-60">
        <h2 className="mb-2 text-base font-semibold text-slate-400">API Connection (coming soon)</h2>
        <p className="text-sm text-slate-400">
          Connect your billing platform directly — coming soon.
        </p>
      </section>

      <section>
        <h2 className="mb-4 text-base font-semibold">Upload History</h2>
        <UsageHistory rows={history ?? []} />
      </section>
    </div>
  )
}
