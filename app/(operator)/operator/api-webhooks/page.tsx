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
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">API &amp; Webhooks</h1>
        <p className="text-sm text-slate-500">
          Manage operator API keys and outgoing webhook subscriptions for external integrations.
        </p>
      </header>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">API Keys</h2>
          <p className="text-sm text-slate-400">Operator keys can read calls, billing data, and manage webhooks.</p>
        </div>
        <ApiKeyManager
          keys={keys}
          onCreateKey={createOperatorApiKeyAction}
          onRevokeKey={revokeOperatorApiKeyAction}
          isAdmin={context.role === 'admin'}
        />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Webhook Subscriptions</h2>
          <p className="text-sm text-slate-400">Subscriptions are signed with HMAC-SHA256 using the secret shown once on creation.</p>
        </div>
        <WebhookManager
          subscriptions={subscriptions}
          onCreateSub={createWebhookSubscriptionAction}
          onDeleteSub={deleteWebhookSubscriptionAction}
          isAdmin={context.role === 'admin'}
        />
      </section>
    </div>
  )
}
