'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { MessageDetail } from '@/components/answering-service/MessageDetail'
import { MessageList } from '@/components/answering-service/MessageList'
import { Skeleton } from '@/components/ui/skeleton'
import type { CallLog } from '@/types/answeringService'

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { data?: T; error?: { message?: string } }

  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message ?? 'Request failed.')
  }

  return payload.data
}

type TabId = 'all' | 'unread' | 'priority'

function MessageListSkeleton() {
  return (
    <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card overflow-hidden" aria-hidden="true">
      {[0, 1, 2].map((item) => (
        <div key={item} className="flex items-center gap-3 h-16 px-5">
          <Skeleton className="h-2 w-2 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  )
}

export default function MessagesClient() {
  const [messages, setMessages] = useState<CallLog[]>([])
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [selectedMessage, setSelectedMessage] = useState<CallLog | null>(null)
  const [isListLoading, setIsListLoading] = useState(true)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabId>('all')
  const [search, setSearch] = useState('')

  async function loadMessages() {
    setIsListLoading(true)
    setError(null)

    try {
      const data = await parseJson<CallLog[]>(
        await fetch('/api/answering-service/messages', { cache: 'no-store' })
      )
      setMessages(data)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load messages.')
    } finally {
      setIsListLoading(false)
    }
  }

  async function loadMessage(id: string) {
    setSelectedMessageId(id)
    setIsDetailLoading(true)
    setError(null)

    try {
      const data = await parseJson<CallLog>(
        await fetch(`/api/answering-service/messages/${id}`, { cache: 'no-store' })
      )
      setSelectedMessage(data)
    } catch (fetchError) {
      setError(
        fetchError instanceof Error ? fetchError.message : 'Failed to load message details.'
      )
    } finally {
      setIsDetailLoading(false)
    }
  }

  useEffect(() => {
    void loadMessages()
  }, [])

  const unreadCount = messages.filter((m) => m.portalStatus === 'new').length

  const filteredMessages = messages.filter((m) => {
    if (tab === 'unread' && m.portalStatus !== 'new') return false
    if (tab === 'priority' && m.priority !== 'high') return false
    if (search) {
      const q = search.toLowerCase()
      return (
        m.message.toLowerCase().includes(q) ||
        (m.callerNumber ?? '').toLowerCase().includes(q) ||
        (m.callerName ?? '').toLowerCase().includes(q)
      )
    }
    return true
  })

  const tabs: { id: TabId; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: `Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}` },
    { id: 'priority', label: 'Priority' },
  ]

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-8">
        {selectedMessageId ? (
          <button
            type="button"
            onClick={async () => {
              setSelectedMessageId(null)
              setSelectedMessage(null)
              await loadMessages()
            }}
            className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to messages
          </button>
        ) : (
          <h1 className="text-xl font-bold text-foreground">Messages</h1>
        )}

        {!selectedMessageId ? (
          <div className="flex h-9 w-[280px] items-center gap-2 rounded-lg bg-muted px-3">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search messages…"
              className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
        ) : null}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        {error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-4">
            <p className="text-sm text-rose-700">{error}</p>
          </div>
        ) : null}

        {selectedMessageId ? (
          isDetailLoading || !selectedMessage ? (
            <MessageListSkeleton />
          ) : (
            <MessageDetail
              message={selectedMessage}
              onRefresh={async () => {
                await Promise.all([loadMessages(), loadMessage(selectedMessage.id)])
              }}
            />
          )
        ) : (
          <div className="flex flex-col gap-4">
            {/* Tabs */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex border-b border-border">
                {tabs.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={`flex h-10 items-center px-4 text-[13px] transition-colors ${
                      tab === id
                        ? 'border-b-2 border-primary font-semibold text-primary'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Message list */}
              {isListLoading ? (
                <MessageListSkeleton />
              ) : filteredMessages.length === 0 ? (
                <div className="flex h-32 items-center justify-center">
                  <p className="text-sm text-muted-foreground">No messages found.</p>
                </div>
              ) : (
                <MessageList
                  messages={filteredMessages}
                  onSelectMessage={(id) => {
                    void loadMessage(id)
                  }}
                  onFlagged={async (id) => {
                    const response = await fetch(
                      `/api/answering-service/messages/${id}/flag-qa`,
                      { method: 'POST' }
                    )

                    if (!response.ok) {
                      throw new Error('Failed to flag message.')
                    }

                    setMessages((current) =>
                      current.map((message) =>
                        message.id === id
                          ? { ...message, portalStatus: 'flagged_qa' }
                          : message
                      )
                    )
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
