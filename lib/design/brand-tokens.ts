/**
 * Brand tokens — customize these to match your brand identity
 *
 * Replace all TODO values with your brand's actual color palette.
 * See the design token files in lib/design/ for the full system.
 */

export const brandTokens = {
  // TODO: replace with your primary dark brand color (e.g. deep navy, charcoal)
  primaryDark: '#1a2b3c',

  // TODO: replace with your secondary/accent brand color (e.g. forest, teal, deep green)
  primaryMid: '#1a4d2e',

  // TODO: replace with your warm accent color (e.g. sand, gold, copper)
  accentWarm: '#d4b896',

  // TODO: replace with gradient string for high-impact hero text
  accentWarmGradient: 'linear-gradient(135deg, #d4b896 0%, #f3e5d0 100%)',

  // TODO: replace with your primary interactive color (links, buttons, focus rings)
  interactionBlue: '#2563eb',
  interactionBlueHover: '#1d4ed8',

  // === APP BACKGROUND PALETTE ===
  // TODO: replace with your app content background (light, slightly warm or cool)
  backgroundApp: '#f7f2ea',
  // TODO: replace with your card/separator border color on the app background
  borderApp: '#e0d5c5',
  // TODO: replace with your primary text color on the app background
  textPrimary: '#1c1917',
  // TODO: replace with your secondary/muted text color on the app background
  textSecondary: '#78716c',
  // TODO: replace with your sidebar dark background color
  sidebarDark: '#070e1a',
  // TODO: replace with your sidebar gradient (top to bottom)
  sidebarGradient: 'linear-gradient(180deg, #070e1a 0%, #1a2b3c 100%)',
} as const
