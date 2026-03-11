import { Suspense, type ReactNode } from 'react'
import { pageLayout } from '@/lib/design/spacing-system'

export default function AuthLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-12">
      <div className={`${pageLayout.ultraNarrowMaxWidth} flex min-h-[calc(100vh-6rem)] items-center`}>
        <Suspense fallback={<div className="w-full" />}>{children}</Suspense>
      </div>
    </div>
  )
}
