'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  EnvelopeSimple,
  Gear,
  Receipt,
  SquaresFour,
} from '@phosphor-icons/react'
import { navStyles } from '@/lib/design/typography-system'
import { touchTarget } from '@/lib/design/motion-system'
import { cn } from '@/lib/utils/cn'

interface BottomNavProps {
  hasUnreadMessages: boolean
}

const ITEMS = [
  { href: '/answering-service/messages', label: 'Messages', icon: EnvelopeSimple },
  { href: '/answering-service/dashboard', label: 'Dashboard', icon: SquaresFour },
  { href: '/answering-service/billing', label: 'Billing', icon: Receipt },
  { href: '/answering-service/settings', label: 'Settings', icon: Gear },
] as const

export function BottomNav({ hasUnreadMessages }: BottomNavProps) {
  const pathname = usePathname()

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      aria-label="Mobile navigation"
    >
      <div className="grid grid-cols-4">
        {ITEMS.map((item) => {
          const isActive = pathname === item.href
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                touchTarget,
                'relative flex flex-col items-center justify-center gap-1 px-2 py-3 text-center',
                isActive ? navStyles.link.active : navStyles.link.inactive
              )}
              style={isActive ? { color: 'var(--portal-brand-color, #3b82f6)' } : undefined}
            >
              <span className="relative">
                <Icon size={20} weight={isActive ? 'fill' : 'regular'} />
                {item.href === '/answering-service/messages' && hasUnreadMessages ? (
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#ef4444]" aria-hidden="true" />
                ) : null}
              </span>
              <span className="text-xs">{item.label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
