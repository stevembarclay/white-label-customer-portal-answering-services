import { redirect } from 'next/navigation'
import { getBusinessContext } from '@/lib/auth/server'
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
  const unreadCount = await getUnreadMessageCount(context.businessId)

  return (
    <div
      className="min-h-screen bg-slate-50"
      style={{ '--portal-brand-color': portalConfig.brandColor } as React.CSSProperties}
    >
      <div className="mx-auto flex max-w-7xl gap-6 px-4 py-6 md:px-6">
        <SideNav hasUnreadMessages={unreadCount > 0} brandName={portalConfig.name} />
        <main className="min-w-0 flex-1 pb-20 md:pb-0">{children}</main>
      </div>
      <BottomNav hasUnreadMessages={unreadCount > 0} />
    </div>
  )
}
