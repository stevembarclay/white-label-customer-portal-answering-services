import { NavLink } from '@/components/operator/NavLink'
import { signOutAction } from '@/lib/auth/actions'

const navItems = [
  { href: '/operator/clients', label: 'Clients' },
  { href: '/operator/usage', label: 'Usage' },
  { href: '/operator/api-webhooks', label: 'API & Webhooks' },
  { href: '/operator/settings', label: 'Settings' },
]

export function OperatorNav({ orgName }: { orgName: string }) {
  return (
    <nav className="hidden md:flex w-48 flex-col shrink-0 gap-1 pt-1">
      <div className="mb-4 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
        {orgName}
      </div>
      {navItems.map((item) => (
        <NavLink key={item.href} href={item.href} label={item.label} />
      ))}
      <form action={signOutAction} className="mt-auto pt-4">
        <button
          type="submit"
          className="w-full px-3 py-1.5 text-left text-sm text-slate-500 hover:text-slate-800 transition-colors"
        >
          Sign out
        </button>
      </form>
    </nav>
  )
}
