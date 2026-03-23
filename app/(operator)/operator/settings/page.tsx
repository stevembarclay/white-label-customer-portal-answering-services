import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'

export default async function SettingsPage() {
  const context = await checkOperatorAccessOrThrow()
  const supabase = await createClient()

  const { data: org } = await supabase
    .from('operator_orgs')
    .select('id, name, slug, branding, settings')
    .eq('id', context.operatorOrgId)
    .single()

  const orgData = org as { name?: string; slug?: string; branding?: { brandColor?: string } } | null

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Operator Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure global defaults for the answering service portal.
        </p>
      </div>

      {/* Portal config card */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex h-[52px] items-center border-b border-border px-5">
          <span className="text-sm font-semibold text-foreground">Portal Configuration</span>
        </div>

        <div className="flex h-14 items-center justify-between border-b border-border px-5">
          <span className="text-[13px] text-muted-foreground">Portal name</span>
          <div className="flex h-9 items-center rounded-lg bg-muted px-3">
            <span className="text-[13px] text-foreground">{orgData?.name ?? '—'}</span>
          </div>
        </div>

        <div className="flex h-14 items-center justify-between border-b border-border px-5">
          <span className="text-[13px] text-muted-foreground">Slug</span>
          <div className="flex h-9 items-center rounded-lg bg-muted px-3">
            <span className="font-mono text-[13px] text-foreground">{orgData?.slug ?? '—'}</span>
          </div>
        </div>

        <div className="flex h-14 items-center justify-between px-5">
          <span className="text-[13px] text-muted-foreground">Default brand color</span>
          <div className="flex items-center gap-2.5">
            <div
              className="h-7 w-7 rounded-md border border-border"
              style={{ backgroundColor: orgData?.branding?.brandColor ?? '#334155' }}
            />
            <span className="text-[13px] text-foreground">
              {orgData?.branding?.brandColor ?? '#334155'}
            </span>
            <span className="text-[12px] text-muted-foreground">(clients can override)</span>
          </div>
        </div>
      </div>

      <p className="text-[13px] text-muted-foreground">
        White-label branding configuration is managed via service role. Contact the platform
        administrator to update logo, colors, or custom domain settings.
      </p>
    </div>
  )
}
