import Link from 'next/link'
import { LoginForm } from '@/components/answering-service/auth/LoginForm'
import { MagicLinkButton } from '@/components/answering-service/auth/MagicLinkButton'
import { portalConfig } from '@/lib/config/portal'
import { cardVariants } from '@/lib/design/card-system'
import { bodyStyles, headingStyles } from '@/lib/design/typography-system'
import { cardSpacing } from '@/lib/design/spacing-system'
import { focusStyles } from '@/lib/design/motion-system'

interface LoginPageProps {
  searchParams: Promise<{ error?: string; next?: string }>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams

  return (
    <div className="w-full">
      <div className="mb-8 text-center">
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl text-base font-semibold text-white"
          style={{ backgroundColor: 'var(--portal-brand-color, #334155)' }}
        >
          {portalConfig.name.slice(0, 2).toUpperCase()}
        </div>
        <h1 className={`${headingStyles.h2.base} text-slate-900`}>{portalConfig.name}</h1>
        <p className={`${bodyStyles.small} mt-2 text-slate-600`}>
          Sign in to review messages, billing, and account settings.
        </p>
      </div>

      <div className={`${cardVariants.interactive} ${cardSpacing.standalone} cursor-default hover:translate-y-0`}>
        <div className="space-y-6">
          <div className="space-y-1">
            <h2 className={headingStyles.h3.base}>Sign in</h2>
            <p className={`${bodyStyles.small} text-slate-600`}>
              Use your email and password, or request a one-click sign-in link.
            </p>
          </div>

          <LoginForm error={params.error} next={params.next} />

          <div className="relative">
            <div className="absolute inset-0 flex items-center" aria-hidden="true">
              <div className="w-full border-t border-slate-200" />
            </div>
            <div className="relative flex justify-center">
              <span className={`${bodyStyles.caption} bg-white px-3 text-slate-500`}>or</span>
            </div>
          </div>

          <MagicLinkButton />

          <div className="flex justify-between gap-4">
            <Link
              href="/login/forgot-password"
              className={`${bodyStyles.caption} ${focusStyles.secondary} text-slate-600 transition-colors hover:text-slate-900`}
            >
              Forgot password?
            </Link>
            <p className={`${bodyStyles.caption} text-slate-500`}>No public signup</p>
          </div>
        </div>
      </div>
    </div>
  )
}
