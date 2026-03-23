import { redirect } from 'next/navigation'
import { getBusinessContext, getUser } from '@/lib/auth/server'
import { portalConfig } from '@/lib/config/portal'
import { checkModuleAccessOrThrow } from '@/lib/middleware/requireModule'
import { getUnreadMessageCount } from '@/lib/services/answering-service/dashboardService'
import { BottomNav } from '@/components/answering-service/BottomNav'
import { SideNav } from '@/components/answering-service/SideNav'

export default async function AnsweringServiceLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const context = await getBusinessContext()

  if (!context) {
    redirect('/login')
  }

  await checkModuleAccessOrThrow('answering_service')

  const [unreadCount, user] = await Promise.all([
    getUnreadMessageCount(context.businessId),
    getUser(),
  ])

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <SideNav
        hasUnreadMessages={unreadCount > 0}
        brandName={portalConfig.name}
        userEmail={user?.email}
      />
      <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
        {children}
      </main>
      <BottomNav hasUnreadMessages={unreadCount > 0} />
    </div>
  )
}
