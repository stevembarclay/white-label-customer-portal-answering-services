'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  EnvelopeSimple,
  Gear,
  Receipt,
  SquaresFour,
} from '@phosphor-icons/react'
import { cardVariants } from '@/lib/design/card-system'
import { navStyles } from '@/lib/design/typography-system'
import { cn } from '@/lib/utils/cn'
import { signOutAction } from '@/lib/auth/actions'

interface SideNavProps {
  hasUnreadMessages: boolean
  brandName: string
}

const ITEMS = [
  { href: '/answering-service/messages', label: 'Messages', icon: EnvelopeSimple },
  { href: '/answering-service/dashboard', label: 'Dashboard', icon: SquaresFour },
  { href: '/answering-service/billing', label: 'Billing', icon: Receipt },
  { href: '/answering-service/settings', label: 'Settings', icon: Gear },
] as const

export function SideNav({ hasUnreadMessages, brandName }: SideNavProps) {
  const pathname = usePathname()

  return (
    <nav className="hidden md:flex md:w-64 md:flex-col md:gap-6" aria-label="Sidebar navigation">
      <div className={`${cardVariants.static} p-5`}>
        <div
          className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl text-sm font-semibold text-white"
          style={{ backgroundColor: 'var(--portal-brand-color, #334155)' }}
        >
          {brandName.slice(0, 2).toUpperCase()}
        </div>
        <p className={navStyles.brand.desktop}>{brandName}</p>
      </div>

      <div className={`${cardVariants.static} flex flex-col gap-2 p-3`}>
        {ITEMS.map((item) => {
          const isActive = pathname === item.href
          const Icon = item.icon

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'relative flex items-center gap-3 rounded-xl px-3 py-3 text-slate-700 transition-colors hover:bg-slate-50',
                isActive ? navStyles.link.active : navStyles.link.inactive
              )}
              style={isActive ? { color: 'var(--portal-brand-color, #334155)' } : undefined}
            >
              <span className="relative">
                <Icon size={20} weight={isActive ? 'fill' : 'regular'} />
                {item.href === '/answering-service/messages' && hasUnreadMessages ? (
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#ef4444]" aria-hidden="true" />
                ) : null}
              </span>
              <span>{item.label}</span>
            </Link>
          )
        })}
        <form action={signOutAction} className="mt-2 border-t border-slate-100 pt-2">
          <button
            type="submit"
            className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-700"
          >
            Sign out
          </button>
        </form>
      </div>
    </nav>
  )
}
