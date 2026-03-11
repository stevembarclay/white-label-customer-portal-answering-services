'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { resetPassword } from '@/app/(auth)/login/actions'
import { cardVariants } from '@/lib/design/card-system'
import { cardSpacing } from '@/lib/design/spacing-system'
import { bodyStyles, headingStyles } from '@/lib/design/typography-system'
import { focusStyles, hoverTransitions, touchTarget } from '@/lib/design/motion-system'

export default function ResetPasswordPage() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const [isPending, startTransition] = useTransition()

  function handleSubmit(formData: FormData) {
    startTransition(() => {
      void resetPassword(formData)
    })
  }

  return (
    <div className={`${cardVariants.interactive} ${cardSpacing.standalone} w-full cursor-default hover:translate-y-0`}>
      <form action={handleSubmit} className="space-y-4">
        <div className="space-y-1">
          <h1 className={headingStyles.h3.base}>Choose a new password</h1>
          <p className={`${bodyStyles.small} text-slate-600`}>
            Your new password must be at least 8 characters long.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className={`${bodyStyles.caption} block text-slate-700`}>
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            disabled={isPending}
            className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="confirm" className={`${bodyStyles.caption} block text-slate-700`}>
            Confirm password
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            disabled={isPending}
            className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'reset-password-error' : undefined}
          />
        </div>

        {error ? (
          <p
            id="reset-password-error"
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
          style={{ backgroundColor: 'var(--portal-brand-color, #3b82f6)' }}
        >
          {isPending ? 'Updating...' : 'Update password'}
        </button>

        <Link href="/login" className={`${bodyStyles.caption} inline-flex text-slate-700 underline underline-offset-4`}>
          Back to sign in
        </Link>
      </form>
    </div>
  )
}
