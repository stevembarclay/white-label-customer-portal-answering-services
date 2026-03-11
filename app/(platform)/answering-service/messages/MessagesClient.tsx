'use client'

import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { MessageDetail } from '@/components/answering-service/MessageDetail'
import { MessageList } from '@/components/answering-service/MessageList'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { cardVariants } from '@/lib/design/card-system'
import { pageLayout } from '@/lib/design/spacing-system'
import { bodyStyles, headingStyles } from '@/lib/design/typography-system'
import type { CallLog } from '@/types/answeringService'

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { data?: T; error?: { message?: string } }

  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error?.message ?? 'Request failed.')
  }

  return payload.data
}

function MessageListSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      {[0, 1, 2].map((item) => (
        <div key={item} className={`${cardVariants.static} p-4`}>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
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

  async function loadMessages() {
    setIsListLoading(true)
    setError(null)

    try {
      const data = await parseJson<CallLog[]>(await fetch('/api/answering-service/messages', { cache: 'no-store' }))
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
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load message details.')
    } finally {
      setIsDetailLoading(false)
    }
  }

  useEffect(() => {
    void loadMessages()
  }, [])

  return (
    <div className={pageLayout.container}>
      <header className="space-y-2">
        <h1 className={`${headingStyles.h1.base} text-slate-900`}>Messages</h1>
        <p className={`${bodyStyles.small} text-slate-600`}>
          Review what came in since your last visit and flag anything that needs QA attention.
        </p>
      </header>

      {error ? (
        <div className={`${cardVariants.static} p-4`}>
          <p className={`${bodyStyles.small} text-rose-700`}>{error}</p>
        </div>
      ) : null}

      {selectedMessageId ? (
        <div className="space-y-4">
          <Button
            type="button"
            variant="ghost"
            className="w-fit"
            onClick={async () => {
              setSelectedMessageId(null)
              setSelectedMessage(null)
              await loadMessages()
            }}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to list
          </Button>

          {isDetailLoading || !selectedMessage ? (
            <MessageListSkeleton />
          ) : (
            <MessageDetail
              message={selectedMessage}
              onRefresh={async () => {
                await Promise.all([loadMessages(), loadMessage(selectedMessage.id)])
              }}
            />
          )}
        </div>
      ) : isListLoading ? (
        <MessageListSkeleton />
      ) : (
        <MessageList
          messages={messages}
          onSelectMessage={(id) => {
            void loadMessage(id)
          }}
          onFlagged={async (id) => {
            const response = await fetch(`/api/answering-service/messages/${id}/flag-qa`, {
              method: 'POST',
            })

            if (!response.ok) {
              throw new Error('Failed to flag message.')
            }

            setMessages((current) =>
              current.map((message) =>
                message.id === id ? { ...message, portalStatus: 'flagged_qa' } : message
              )
            )
          }}
        />
      )}
    </div>
  )
}
