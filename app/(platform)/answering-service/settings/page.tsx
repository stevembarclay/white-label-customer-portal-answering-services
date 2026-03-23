import { redirect } from 'next/navigation'
import { getBusinessContext } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'
import { ApiKeyManager } from '@/components/operator/ApiKeyManager'
import { createBusinessApiKeyAction, revokeBusinessApiKeyAction } from './actions'

export default async function SettingsPage() {
  const context = await getBusinessContext()
  if (!context) {
    redirect('/login')
  }

  const supabase = await createClient()
  const { data: rawKeys } = await supabase
    .from('api_keys')
    .select('id, label, scopes, created_at, revoked_at')
    .eq('business_id', context.businessId)
    .order('created_at', { ascending: false })

  const keys = (rawKeys ?? []).map((key) => ({
    id: key.id,
    label: key.label as string,
    scopes: (key.scopes as string[]) ?? [],
    createdAt: key.created_at as string,
    revokedAt: (key.revoked_at as string | null) ?? null,
  }))

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your account, API keys, and notification preferences.
        </p>
      </div>

      {/* API Keys card */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex h-14 items-center justify-between border-b border-border px-5">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-foreground">API Keys</span>
            <span className="text-[12px] text-muted-foreground">
              Keys for authenticating third-party integrations
            </span>
          </div>
        </div>

        <div className="p-5">
          <ApiKeyManager
            keys={keys}
            onCreateKey={createBusinessApiKeyAction}
            onRevokeKey={revokeBusinessApiKeyAction}
            isAdmin={true}
          />
        </div>
      </div>
    </div>
  )
}
