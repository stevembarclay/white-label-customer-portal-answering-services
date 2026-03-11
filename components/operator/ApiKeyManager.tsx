'use client'

import { useState, useTransition } from 'react'

interface Key {
  id: string
  label: string
  scopes: string[]
  createdAt: string
  revokedAt: string | null
}

interface CreateKeySuccess {
  rawKey: string
}

interface CreateKeyFailure {
  error: string
}

export function ApiKeyManager({
  keys,
  onCreateKey,
  onRevokeKey,
  isAdmin,
}: {
  keys: Key[]
  onCreateKey: (label: string, scopes: string[]) => Promise<CreateKeySuccess | CreateKeyFailure>
  onRevokeKey: (id: string) => Promise<void>
  isAdmin: boolean
}) {
  const [newLabel, setNewLabel] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const activeKeys = keys.filter((key) => !key.revokedAt)

  function handleCreate() {
    if (!newLabel.trim()) return

    startTransition(async () => {
      setError(null)
      const result = await onCreateKey(newLabel.trim(), ['calls:read', 'billing:read'])

      if ('error' in result) {
        setError(result.error)
        return
      }

      setCreatedKey(result.rawKey)
      setNewLabel('')
    })
  }

  function handleRevoke(id: string) {
    startTransition(async () => {
      setError(null)
      try {
        await onRevokeKey(id)
      } catch (revokeError) {
        setError(revokeError instanceof Error ? revokeError.message : 'Failed to revoke API key.')
      }
    })
  }

  return (
    <div className="space-y-4">
      {createdKey && (
        <div className="rounded-md border border-green-200 bg-green-50 p-4">
          <p className="text-sm font-medium text-green-800">
            API key created. Save it now, it will not be shown again.
          </p>
          <code className="mt-2 block break-all rounded bg-white px-3 py-2 text-xs">{createdKey}</code>
          <button
            type="button"
            onClick={() => setCreatedKey(null)}
            className="mt-2 text-xs text-green-700 hover:underline"
          >
            I&apos;ve saved it
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {isAdmin && (
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Key label"
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            className="flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={isPending || !newLabel.trim()}
            className="rounded-md bg-slate-900 px-4 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {isPending ? 'Working…' : 'Create key'}
          </button>
        </div>
      )}

      <ul className="space-y-2">
        {activeKeys.map((key) => (
          <li key={key.id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{key.label}</p>
              <p className="text-xs text-slate-400">{key.scopes.join(', ')}</p>
              <p className="text-xs text-slate-400">
                Created {new Date(key.createdAt).toLocaleDateString()}
              </p>
            </div>
            {isAdmin && (
              <button
                type="button"
                onClick={() => handleRevoke(key.id)}
                disabled={isPending}
                className="shrink-0 text-xs text-red-600 hover:underline disabled:opacity-50"
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>

      {activeKeys.length === 0 && <p className="text-sm text-slate-400">No active API keys.</p>}
    </div>
  )
}
