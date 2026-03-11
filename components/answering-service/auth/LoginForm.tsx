'use client'

import { useTransition } from 'react'
import { signInWithPassword } from '@/app/(auth)/login/actions'
import { focusStyles, hoverTransitions, touchTarget } from '@/lib/design/motion-system'
import { bodyStyles } from '@/lib/design/typography-system'

interface LoginFormProps {
  error?: string
  next?: string
}

const inputClasses = [
  'w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-sm',
  'placeholder:text-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400',
  focusStyles.input,
].join(' ')

export function LoginForm({ error, next }: LoginFormProps) {
  const [isPending, startTransition] = useTransition()

  function handleSubmit(formData: FormData) {
    startTransition(() => {
      void signInWithPassword(formData)
    })
  }

  return (
    <form action={handleSubmit} className="space-y-4">
      <input type="hidden" name="next" value={next ?? '/answering-service'} />

      <div className="space-y-2">
        <label htmlFor="email" className={`${bodyStyles.caption} block text-slate-700`}>
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          disabled={isPending}
          className={inputClasses}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'login-error' : undefined}
          placeholder="you@example.com"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="password" className={`${bodyStyles.caption} block text-slate-700`}>
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={isPending}
          className={inputClasses}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'login-error' : undefined}
          placeholder="Enter your password"
        />
      </div>

      {error ? (
        <p
          id="login-error"
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
        {isPending ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  )
}
