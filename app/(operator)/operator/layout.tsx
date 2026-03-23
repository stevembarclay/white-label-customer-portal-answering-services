import { checkOperatorAccessOrThrow, getUser } from '@/lib/auth/server'
import { OperatorNav } from '@/components/operator/OperatorNav'

export default async function OperatorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await checkOperatorAccessOrThrow()
  const user = await getUser()

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <OperatorNav userEmail={user?.email} />
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}
