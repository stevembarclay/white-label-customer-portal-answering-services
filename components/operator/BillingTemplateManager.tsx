'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { BillingTemplate, BillingTemplateInput, TemplateRule } from '@/lib/services/operator/billingTemplateService'

const RULE_TYPES = [
  { value: 'per_call', label: 'Per call' },
  { value: 'per_minute', label: 'Per minute' },
  { value: 'flat_monthly', label: 'Flat monthly' },
  { value: 'bucket', label: 'Bucket (included + overage)' },
] as const

interface Props {
  templates: BillingTemplate[]
  isAdmin: boolean
  createAction: (input: BillingTemplateInput) => Promise<void>
  deleteAction: (id: string) => Promise<void>
}

const emptyRule = (): TemplateRule => ({
  type: 'per_call',
  name: '',
  amount: 0,
  active: true,
})

export function BillingTemplateManager({ templates, isAdmin, createAction, deleteAction }: Props) {
  const [isPending, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [rules, setRules] = useState<TemplateRule[]>([emptyRule()])
  const [error, setError] = useState<string | null>(null)

  function updateRule(index: number, patch: Partial<TemplateRule>) {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function handleCreate() {
    if (!templateName.trim()) { setError('Template name is required.'); return }
    if (rules.some((r) => !r.name.trim())) { setError('All rules must have a name.'); return }
    setError(null)

    startTransition(async () => {
      try {
        await createAction({ name: templateName.trim(), rules })
        setTemplateName('')
        setRules([emptyRule()])
        setShowForm(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to create template.')
      }
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteAction(id)
    })
  }

  return (
    <div className="space-y-6">
      {/* Template list */}
      {templates.length === 0 ? (
        <p className="text-sm text-slate-500">No templates yet.</p>
      ) : (
        <div className="divide-y divide-slate-200 rounded-lg border border-slate-200">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{t.name}</p>
                <p className="text-xs text-slate-400">{t.rules.length} rule{t.rules.length !== 1 ? 's' : ''}</p>
              </div>
              {isAdmin && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-600 hover:text-red-700"
                  onClick={() => handleDelete(t.id)}
                  disabled={isPending}
                >
                  Delete
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* New template form */}
      {isAdmin && (
        <>
          {!showForm ? (
            <Button variant="outline" size="sm" onClick={() => setShowForm(true)}>
              + New Template
            </Button>
          ) : (
            <div className="space-y-4 rounded-lg border border-slate-200 p-4">
              <h3 className="text-sm font-semibold">New Rate Card Template</h3>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Template name</label>
                <Input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="e.g. Standard Medical"
                  className="max-w-xs"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-600">Rules</label>
                {rules.map((rule, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <select
                      value={rule.type}
                      onChange={(e) => updateRule(i, { type: e.target.value as TemplateRule['type'] })}
                      className="rounded border border-slate-200 px-2 py-1 text-sm"
                    >
                      {RULE_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                    </select>
                    <Input
                      value={rule.name}
                      onChange={(e) => updateRule(i, { name: e.target.value })}
                      placeholder="Rule name"
                      className="w-40"
                    />
                    <div className="flex items-center gap-1">
                      <span className="text-sm text-slate-400">$</span>
                      <Input
                        type="number"
                        value={rule.amount / 100}
                        onChange={(e) => updateRule(i, { amount: Math.round(parseFloat(e.target.value || '0') * 100) })}
                        placeholder="0.00"
                        className="w-24"
                        min="0"
                        step="0.01"
                      />
                    </div>
                    {rules.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setRules((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-xs text-red-500 hover:text-red-700"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setRules((prev) => [...prev, emptyRule()])}
                  className="text-xs text-slate-500 hover:text-slate-700"
                >
                  + Add rule
                </button>
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex gap-2">
                <Button size="sm" onClick={handleCreate} disabled={isPending}>
                  {isPending ? 'Saving…' : 'Save Template'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); setError(null) }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
