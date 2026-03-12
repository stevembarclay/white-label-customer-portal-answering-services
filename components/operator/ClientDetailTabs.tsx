'use client'

import { formatDistanceToNow } from 'date-fns'
import { HealthScoreBadge } from '@/components/operator/HealthScoreBadge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ClientDetail, ClientOnCallStatus } from '@/lib/services/operator/operatorService'

export function ClientDetailTabs({
  client,
  onCallStatus,
}: {
  client: ClientDetail
  onCallStatus: ClientOnCallStatus
}) {
  const { healthBreakdown: hs } = client

  return (
    <Tabs defaultValue="overview">
      <TabsList>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="billing">Billing</TabsTrigger>
        <TabsTrigger value="calls">Calls</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-4 pt-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <ScoreCard label="Login recency" value={hs.loginRecency} max={40} />
          <ScoreCard label="Open high-priority" value={hs.unresolvedHighPriority} max={30} />
          <ScoreCard label="Reviewed in 7d" value={hs.reviewedWithin7d} max={20} />
          <ScoreCard label="Onboarding" value={hs.onboardingComplete} max={10} />
        </div>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <dt className="text-slate-500">Last login</dt>
          <dd>{client.lastLoginAt
            ? formatDistanceToNow(new Date(client.lastLoginAt), { addSuffix: true })
            : 'Never'}</dd>
          <dt className="text-slate-500">Open high-priority calls</dt>
          <dd>{client.openHighPriorityCount}</dd>
          <dt className="text-slate-500">Calls this month</dt>
          <dd>{client.callsThisMonth} (vs {client.callsLastMonth} last month)</dd>
          <dt className="text-slate-500">Onboarding</dt>
          <dd>{client.onboardingStatus ?? 'Not started'}</dd>
        </dl>
        {/* Who to Call (read-only) */}
        <div className="rounded-md border border-slate-200 p-4">
          <h3 className="text-sm font-semibold mb-2">Who to Call</h3>
          {onCallStatus.shiftName ? (
            <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
              <dt className="text-slate-500">Shift</dt>
              <dd>{onCallStatus.shiftName}</dd>
              <dt className="text-slate-500">Contact</dt>
              <dd>{onCallStatus.contactName ?? '—'}</dd>
              {onCallStatus.contactRole && (
                <>
                  <dt className="text-slate-500">Role</dt>
                  <dd>{onCallStatus.contactRole}</dd>
                </>
              )}
              {onCallStatus.contactPhone && (
                <>
                  <dt className="text-slate-500">Phone</dt>
                  <dd>{onCallStatus.contactPhone}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="text-sm text-slate-400">No coverage scheduled right now.</p>
          )}
        </div>
      </TabsContent>

      <TabsContent value="billing" className="pt-4">
        <p className="text-sm text-slate-500">Usage data will appear here once billing ingest is set up.</p>
        <div className="mt-4 space-y-2">
          {client.billingRules.map((rule) => (
            <div key={rule.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
              <span className="font-medium">{rule.name}</span>
              <span className="ml-2 text-slate-500">{rule.type}</span>
              {!rule.active && <span className="ml-2 text-orange-500">(inactive)</span>}
            </div>
          ))}
        </div>
      </TabsContent>

      <TabsContent value="calls" className="pt-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="pb-2 pr-4 font-medium">Time</th>
              <th className="pb-2 pr-4 font-medium">Type</th>
              <th className="pb-2 pr-4 font-medium">Priority</th>
              <th className="pb-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {client.recentCalls.map((call) => (
              <tr key={call.id} className="border-b border-slate-100">
                <td className="py-2 pr-4 text-slate-500">
                  {formatDistanceToNow(new Date(call.timestamp), { addSuffix: true })}
                </td>
                <td className="py-2 pr-4">{call.callType}</td>
                <td className="py-2 pr-4">{call.priority}</td>
                <td className="py-2">{call.portalStatus}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TabsContent>

      <TabsContent value="settings" className="space-y-6 pt-4">
        <div>
          <h3 className="mb-2 text-sm font-semibold">API Keys</h3>
          {client.apiKeys.filter((k) => !k.revokedAt).map((key) => (
            <div key={key.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
              <span className="font-medium">{key.label}</span>
              <span className="ml-2 text-slate-400">{key.scopes.join(', ')}</span>
            </div>
          ))}
          {client.apiKeys.filter((k) => !k.revokedAt).length === 0 && (
            <p className="text-sm text-slate-400">No active API keys.</p>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Health Score Override</h3>
          <p className="text-sm text-slate-500">
            {client.healthScoreOverride !== null
              ? `Currently overridden to ${client.healthScoreOverride}`
              : 'No override — formula score is used.'}
          </p>
        </div>
      </TabsContent>
    </Tabs>
  )
}

function ScoreCard({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="rounded-md border border-slate-200 p-3 text-center">
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      <div className="text-xs text-slate-500">/{max} {label}</div>
    </div>
  )
}
