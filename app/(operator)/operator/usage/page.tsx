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
    .select(
      'id, business_id, period_date, total_calls, total_minutes, source, status, error_detail, created_at'
    )
    .eq('operator_org_id', context.operatorOrgId)
    .order('created_at', { ascending: false })
    .limit(30)

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Usage</h1>
        <p className="text-sm text-muted-foreground">
          Upload and review usage data across all clients.
        </p>
      </div>

      {/* Upload panels */}
      {context.role === 'admin' ? (
        <>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex h-[52px] items-center border-b border-border px-5">
              <span className="text-sm font-semibold text-foreground">Upload CSV</span>
            </div>
            <div className="p-5">
              <UsageUploadPanel />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex h-[52px] items-center border-b border-border px-5">
              <span className="text-sm font-semibold text-foreground">Upload Call Logs</span>
            </div>
            <div className="p-5">
              <CallUploadPanel />
            </div>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Admin role required to upload usage data.
        </p>
      )}

      {/* Upload history */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex h-[52px] items-center border-b border-border px-5">
          <span className="text-sm font-semibold text-foreground">Upload History</span>
        </div>
        <div className="p-5">
          <UsageHistory rows={history ?? []} />
        </div>
      </div>
    </div>
  )
}
