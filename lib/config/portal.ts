// lib/config/portal.ts
// All white-label configuration. Components import from here — never from process.env directly.

export const portalConfig = {
  name: process.env.PORTAL_NAME ?? 'Answering Service Portal',
  logoUrl: process.env.PORTAL_LOGO_URL,          // undefined if not set — use as boolean check
  brandColor: process.env.PORTAL_BRAND_COLOR ?? '#3b82f6',
  supportEmail: process.env.PORTAL_SUPPORT_EMAIL ?? 'support@example.com',
} as const

export type PortalConfig = typeof portalConfig
