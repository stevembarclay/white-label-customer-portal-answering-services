'use client'

import { useState } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { HealthScoreBadge } from '@/components/operator/HealthScoreBadge'
import type { ClientRow } from '@/types/operator'

type Segment = 'all' | 'at_risk' | 'inactive'
type SortKey = 'health_asc' | 'health_desc' | 'name' | 'last_login' | 'calls'

export function ClientTable({ clients }: { clients: ClientRow[] }) {
  const [segment, setSegment] = useState<Segment>('all')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('health_asc')

  const now = new Date()

  const filtered = clients
    .filter((c) => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false
      if (segment === 'at_risk' && c.healthScore >= 50) return false
      if (segment === 'inactive') {
        if (!c.lastLoginAt) return true
        const daysSince = (now.getTime() - new Date(c.lastLoginAt).getTime()) / 86_400_000
        if (daysSince <= 30) return false
      }
      return true
    })
    .sort((a, b) => {
      switch (sortKey) {
        case 'health_asc': return a.healthScore - b.healthScore
        case 'health_desc': return b.healthScore - a.healthScore
        case 'name': return a.name.localeCompare(b.name)
        case 'last_login': return (b.lastLoginAt ?? '').localeCompare(a.lastLoginAt ?? '')
        case 'calls': return b.callsPerWeek - a.callsPerWeek
        default: return 0
      }
    })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search clients…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
        />
        <div className="flex rounded-md border border-slate-200 text-sm">
          {(['all', 'at_risk', 'inactive'] as Segment[]).map((s) => (
            <button
              key={s}
              onClick={() => setSegment(s)}
              className={`px-3 py-1.5 first:rounded-l-md last:rounded-r-md ${
                segment === s ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {s === 'all' ? 'All' : s === 'at_risk' ? 'At risk' : 'Inactive'}
            </button>
          ))}
        </div>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm"
        >
          <option value="health_asc">Health: low → high</option>
          <option value="health_desc">Health: high → low</option>
          <option value="name">Name A–Z</option>
          <option value="last_login">Most recently active</option>
          <option value="calls">Most calls/wk</option>
        </select>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            <th className="pb-2 pr-4 font-medium">Client</th>
            <th className="pb-2 pr-4 font-medium">Health</th>
            <th className="pb-2 pr-4 font-medium">Last login</th>
            <th className="pb-2 pr-4 font-medium">Calls/wk</th>
            <th className="pb-2 pr-4 font-medium">Billing</th>
            <th className="pb-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {filtered.map((client) => (
            <tr key={client.id} className="border-b border-slate-100">
              <td className="py-3 pr-4 font-medium">{client.name}</td>
              <td className="py-3 pr-4">
                <HealthScoreBadge score={client.healthScore} isOverride={client.isHealthScoreOverride} />
              </td>
              <td className="py-3 pr-4 text-slate-500">
                {client.lastLoginAt
                  ? formatDistanceToNow(new Date(client.lastLoginAt), { addSuffix: true })
                  : 'Never'}
              </td>
              <td className="py-3 pr-4 tabular-nums">{client.callsPerWeek}</td>
              <td className="py-3 pr-4">
                {client.billingPercent !== null ? (
                  <span className="tabular-nums">{client.billingPercent}%</span>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
              <td className="py-3">
                <Link
                  href={`/operator/clients/${client.id}`}
                  className="text-slate-500 hover:text-slate-900"
                >
                  View →
                </Link>
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={6} className="py-8 text-center text-slate-400">
                No clients match the current filter.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
