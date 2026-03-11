import Link from 'next/link'
import { cardVariants } from '@/lib/design/card-system'
import { cardSpacing } from '@/lib/design/spacing-system'
import { bodyStyles, headingStyles } from '@/lib/design/typography-system'

interface MagicLinkSentPageProps {
  searchParams: Promise<{ email?: string }>
}

export default async function MagicLinkSentPage({ searchParams }: MagicLinkSentPageProps) {
  const params = await searchParams
  const email = params.email

  return (
    <div className={`${cardVariants.interactive} ${cardSpacing.standalone} w-full cursor-default hover:translate-y-0`}>
      <div className="space-y-4 text-center">
        <h1 className={headingStyles.h3.base}>Check your inbox</h1>
        <p className={`${bodyStyles.small} text-slate-600`}>
          We sent a sign-in link{email ? ` to ${email}` : ''}. Open that email on this device to continue.
        </p>
        <Link href="/login" className={`${bodyStyles.caption} text-slate-700 underline underline-offset-4`}>
          Back to sign in
        </Link>
      </div>
    </div>
  )
}
