import type { Metadata } from 'next'
import { portalConfig } from '@/lib/config/portal'
import './globals.css'

export const metadata: Metadata = {
  title: portalConfig.name,
  description: 'Answering service customer portal — messages, billing, and account management.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: portalConfig.name,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content={portalConfig.brandColor} />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <style>{`:root { --portal-brand-color: ${portalConfig.brandColor}; }`}</style>
      </head>
      <body>{children}</body>
    </html>
  )
}
