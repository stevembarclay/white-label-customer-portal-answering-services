import { redirect } from 'next/navigation'

import { ApiKeyManager } from '@/components/operator/ApiKeyManager'
import { signOutAction } from '@/lib/auth/actions'
import { getBusinessContext } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'

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
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-slate-500">
          Create read-only API keys for your business to integrate calls and billing data into your systems.
        </p>
      </header>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">API Keys</h2>
          <p className="text-sm text-slate-400">
            Business API keys only include `calls:read` and `billing:read`. Upload access is never granted here.
          </p>
        </div>
        <ApiKeyManager
          keys={keys}
          onCreateKey={async (label) => createBusinessApiKeyAction(label)}
          onRevokeKey={revokeBusinessApiKeyAction}
          isAdmin={true}
        />
      </section>

      <section className="border-t border-slate-100 pt-6">
        <form action={signOutAction}>
          <button
            type="submit"
            className="text-sm text-slate-500 hover:text-slate-800 transition-colors"
          >
            Sign out
          </button>
        </form>
      </section>
    </div>
  )
}
