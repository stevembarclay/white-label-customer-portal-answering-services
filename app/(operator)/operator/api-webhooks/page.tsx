import { ApiKeyManager } from '@/components/operator/ApiKeyManager'
import { WebhookManager } from '@/components/operator/WebhookManager'
import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'

import {
  createOperatorApiKeyAction,
  createWebhookSubscriptionAction,
  deleteWebhookSubscriptionAction,
  revokeOperatorApiKeyAction,
} from './actions'

export default async function ApiWebhooksPage() {
  const context = await checkOperatorAccessOrThrow()
  const supabase = await createClient()

  const { data: rawKeys } = await supabase
    .from('api_keys')
    .select('id, label, scopes, created_at, revoked_at')
    .eq('operator_org_id', context.operatorOrgId)
    .order('created_at', { ascending: false })

  const { data: rawSubscriptions } = await supabase
    .from('webhook_subscriptions')
    .select('id, url, topics, status, consecutive_failure_count, created_at')
    .eq('operator_org_id', context.operatorOrgId)
    .order('created_at', { ascending: false })

  const keys = (rawKeys ?? []).map((key) => ({
    id: key.id,
    label: key.label as string,
    scopes: (key.scopes as string[]) ?? [],
    createdAt: key.created_at as string,
    revokedAt: (key.revoked_at as string | null) ?? null,
  }))

  const subscriptions = (rawSubscriptions ?? []).map((subscription) => ({
    id: subscription.id,
    url: subscription.url as string,
    topics: (subscription.topics as string[]) ?? [],
    status: subscription.status as string,
    consecutiveFailureCount: Number(subscription.consecutive_failure_count ?? 0),
  }))

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">API &amp; Webhooks</h1>
        <p className="text-sm text-muted-foreground">
          Manage operator-level API keys and configure event webhooks.
        </p>
      </div>

      {/* API Keys card */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex h-[52px] items-center border-b border-border px-5">
          <span className="text-sm font-semibold text-foreground">Operator API Keys</span>
        </div>
        <div className="p-5">
          <ApiKeyManager
            keys={keys}
            onCreateKey={createOperatorApiKeyAction}
            onRevokeKey={revokeOperatorApiKeyAction}
            isAdmin={context.role === 'admin'}
            availableScopes={['calls:read', 'billing:read', 'usage:write', 'on_call:read']}
          />
        </div>
      </div>

      {/* Webhooks card */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex h-[52px] items-center border-b border-border px-5">
          <span className="text-sm font-semibold text-foreground">Webhooks</span>
        </div>
        <div className="p-5">
          <WebhookManager
            subscriptions={subscriptions}
            onCreateSub={createWebhookSubscriptionAction}
            onDeleteSub={deleteWebhookSubscriptionAction}
            isAdmin={context.role === 'admin'}
          />
        </div>
      </div>
    </div>
  )
}
