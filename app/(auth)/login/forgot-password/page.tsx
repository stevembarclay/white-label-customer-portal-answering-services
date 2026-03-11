'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { sendPasswordResetEmail } from '@/app/(auth)/login/actions'
import { cardVariants } from '@/lib/design/card-system'
import { cardSpacing } from '@/lib/design/spacing-system'
import { bodyStyles, headingStyles } from '@/lib/design/typography-system'
import { focusStyles, hoverTransitions, touchTarget } from '@/lib/design/motion-system'

export default function ForgotPasswordPage() {
  const searchParams = useSearchParams()
  const sent = searchParams.get('sent') === 'true'
  const error = searchParams.get('error')
  const [isPending, startTransition] = useTransition()

  function handleSubmit(formData: FormData) {
    startTransition(() => {
      void sendPasswordResetEmail(formData)
    })
  }

  return (
    <div className={`${cardVariants.interactive} ${cardSpacing.standalone} w-full cursor-default hover:translate-y-0`}>
      {sent ? (
        <div className="space-y-4 text-center">
          <h1 className={headingStyles.h3.base}>Reset link sent</h1>
          <p className={`${bodyStyles.small} text-slate-600`}>
            If that email belongs to an account, a reset link is on its way now.
          </p>
          <Link href="/login" className={`${bodyStyles.caption} text-slate-700 underline underline-offset-4`}>
            Back to sign in
          </Link>
        </div>
      ) : (
        <form action={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <h1 className={headingStyles.h3.base}>Forgot your password?</h1>
            <p className={`${bodyStyles.small} text-slate-600`}>
              Enter your email and we will send a reset link.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="email" className={`${bodyStyles.caption} block text-slate-700`}>
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              disabled={isPending}
              className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm placeholder:text-slate-400"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? 'forgot-password-error' : undefined}
              placeholder="you@example.com"
            />
          </div>

          {error ? (
            <p
              id="forgot-password-error"
              role="alert"
              className={`${bodyStyles.caption} rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700`}
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isPending}
            className={`${touchTarget} ${hoverTransitions.button} ${focusStyles.primary} w-full rounded-lg px-4 py-3 font-semibold text-white disabled:scale-100 disabled:cursor-not-allowed disabled:opacity-60`}
            style={{ backgroundColor: 'var(--portal-brand-color, #334155)' }}
          >
            {isPending ? 'Sending...' : 'Send reset link'}
          </button>

          <Link href="/login" className={`${bodyStyles.caption} inline-flex text-slate-700 underline underline-offset-4`}>
            Back to sign in
          </Link>
        </form>
      )}
    </div>
  )
}
