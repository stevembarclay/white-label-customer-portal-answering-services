# UI Color System Clean

**Date:** 2026-03-11
**Status:** Approved
**Scope:** Full clean — remove all gold/bronze/warm tokens and establish a neutral, white-label-first color system.

---

## Problem

The codebase was extracted from a parent repo that used a luxury/institutional warm aesthetic (bronze `#A68A64`, gold `#D4B483`, sandy backgrounds `#f7f2ea`, warm borders `#e0d5c5`). These colors bleed into the UI through:

- `globals.css`: `--color-primary` is bronze, `--color-ring` is gold, focus rings fire gold on every interactive element
- `brand-tokens.ts`: all values are TODOs or warm parent-repo placeholders
- `color-system.ts`: `warmPalette` uses warm beige borders and stone text
- Three components with hardcoded `border-bronze` / `ring-bronze` class names

This platform is a white-label answering service portal. Gold has no place here.

---

## Approach: Hybrid (C)

`--portal-brand-color` drives high-intent CTAs (primary buttons, active nav states). Slate drives utility chrome (focus rings on inputs/cards, wizard steps, borders, separators).

This gives operators meaningful brand expression on the most visible interactive elements while keeping accessibility guarantees on utility chrome regardless of what color is injected.

**Operator constraint:** `PORTAL_BRAND_COLOR` must be dark enough that white (`#ffffff`) text achieves 4.5:1 contrast against it. Document this requirement as a comment in `lib/config/portal.ts`.

---

## Token Architecture

| Role | Color source | How applied |
|------|-------------|-------------|
| Primary buttons, high-intent CTAs | `--portal-brand-color` (operator-injected) | `--color-primary: var(--portal-brand-color, #334155)` |
| Primary button focus ring | `--portal-brand-color` (intentional — matches the button) | `focusStyles.primary` keeps `ring-primary` |
| Input / card focus rings | Slate-400 (fixed) | `focusStyles.input` uses `ring-slate-400`; `:focus-visible` base rule uses `--color-ring` |
| `--color-ring` | Slate-400 `#94a3b8` | Applied by shadcn ring utilities and base `:focus-visible` |
| Wizard steps, checkboxes | Slate-600 (fixed, hardcoded in component) | Tailwind `slate-600` class |
| Card / table / overlay borders | Slate-200 | `warmPalette.border` → `'border-slate-200'` |
| Page separators | Slate-300 | `warmPalette.separatorColor` → `'#cbd5e1'` |
| Body text | Slate-900 | `warmPalette.textClass` → `'text-slate-900'` |
| Muted text | Slate-500 | `warmPalette.subtextClass` → `'text-slate-500'` |
| App background | Slate-50 `#f8fafc` | Already correct in `globals.css`, no change needed |
| Status colors | Emerald / Amber / Rose / Blue | Unchanged |

---

## File Changes

### 1. `app/globals.css`

**Remove** from `@theme`:
- `--color-gunmetal`, `--color-gunmetal-light`, `--color-gunmetal-lighter`, `--color-gunmetal-lightest`
- `--color-bronze`, `--color-bronze-light`, `--color-bronze-dark`
- `--color-gold`
- `--color-tactical`

**Update** semantic tokens:
```css
--color-primary: var(--portal-brand-color, #334155);
--color-primary-foreground: #ffffff;
--color-ring: #94a3b8;
```

**Update** `:focus-visible` rule — replace `var(--color-gold)` and the dark box-shadow with slate equivalents:
```css
:focus-visible {
  outline: 2px solid var(--color-ring);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px rgba(148, 163, 184, 0.2);
}
```

`--color-background` is already `#f8fafc` — no change needed.

`--color-steel` family stays — neutral UI chrome, no brand meaning.

---

### 2. `app/layout.tsx` — move `--portal-brand-color` to `<head>`

**Problem:** The variable is currently injected as an inline style on layout divs. Radix UI portals (dialogs, dropdowns, popovers, toasts) render at the document body, outside those divs, so they never inherit `--portal-brand-color` — primary buttons inside modals would fall back to slate instead of the brand color.

**Fix:** Inject once in the root layout's `<head>`, not in child layout divs. `app/layout.tsx` already imports `portalConfig`, making this trivial:

```tsx
<head>
  <meta name="theme-color" content={portalConfig.brandColor} />
  <link rel="apple-touch-icon" href="/icon-192.png" />
  <style>{`:root { --portal-brand-color: ${portalConfig.brandColor}; }`}</style>
</head>
```

**Remove** the `style={{ '--portal-brand-color': portalConfig.brandColor }}` inline style prop from the wrapper divs in both:
- `app/(platform)/answering-service/layout.tsx`
- `app/(auth)/layout.tsx`

---

### 3. `lib/config/portal.ts`

Add an inline comment documenting the contrast constraint:

```ts
// PORTAL_BRAND_COLOR must be dark enough that white (#fff) text achieves 4.5:1 contrast.
// Verify at: https://webaim.org/resources/contrastchecker/
brandColor: process.env.PORTAL_BRAND_COLOR ?? '#334155',
```

Also update the default fallback from `#3b82f6` (blue) to `#334155` (slate-700), consistent with the new `--color-primary` fallback.

---

### 4. `lib/design/brand-tokens.ts`

Replace all placeholder values. Remove warm-specific tokens with no neutral analog. Remove dead tokens (`sidebarDark`, `sidebarGradient`) that are defined but never imported outside this file.

```ts
/**
 * Brand tokens — neutral defaults for the white-label answering service portal.
 * Interactive color identity comes from PORTAL_BRAND_COLOR (see lib/config/portal.ts).
 */
export const brandTokens = {
  primaryDark: '#0f172a',           // slate-950
  primaryMid: '#334155',            // slate-700
  interactionBlue: '#2563eb',       // kept for explicit blue contexts
  interactionBlueHover: '#1d4ed8',

  // App background palette
  backgroundApp: '#f8fafc',         // slate-50
  borderApp: '#e2e8f0',             // slate-200
  textPrimary: '#0f172a',           // slate-950
  textSecondary: '#64748b',         // slate-500
} as const
```

**Removed:** `accentWarm`, `accentWarmGradient`, `sidebarDark`, `sidebarGradient` (last two were defined but never consumed outside this file).

---

### 5. `lib/design/color-system.ts`

**A. Remove the `import { brandTokens }` statement** — `warmPalette` will no longer reference it, and no other export in this file uses it.

**B. Keep the export name `warmPalette`** (renaming would require touching 4 importing files for no functional benefit). Update values and update the stale JSDoc:

```ts
/**
 * App background palette — for components rendered on the app background color.
 * Card borders, separators, and text on the app bg use these tokens.
 */
export const warmPalette = {
  /** Card border on app bg */
  border: 'border-slate-200',
  /** Inline borderColor value for style={{ borderColor }} contexts */
  borderColor: '#e2e8f0',
  /**
   * Page-level separator color (PageHeader bottom border).
   */
  separatorColor: '#cbd5e1',
  /** Section separator */
  separator: 'border-b pb-6 mb-6 border-slate-200',
  /** Primary text on app bg (page titles) */
  textClass: 'text-slate-900',
  /** Secondary text on app bg (subtitles) */
  subtextClass: 'text-slate-500',
} as const
```

**C. Remove `marketingGradients`** — it is defined in this file but never imported anywhere outside of it. Dead code, no consumers.

**D. Fix `buttonVariants.primary`** — the current value references `premium-button-primary`, a CSS utility class that does not exist in `globals.css` (only `premium-card` and the shadow utilities exist there). Replace with explicit Tailwind classes:

```ts
primary: cn(
  'bg-primary text-primary-foreground',
  'hover:opacity-90',
  'hover:scale-[1.02]',
  'active:scale-[0.98]',
  'transition-all duration-200 ease-out',
),
```

---

### 6. `lib/design/motion-system.ts`

`focusStyles.input` currently applies `ring-primary` to inputs. Under the hybrid approach, inputs are utility chrome and should use a fixed slate ring, not the brand color.

```ts
// Before
input: cn(
  'focus-visible:outline-none',
  'focus-visible:ring-2 focus-visible:ring-primary',
  'focus-visible:border-primary',
),

// After
input: cn(
  'focus-visible:outline-none',
  'focus-visible:ring-2 focus-visible:ring-slate-400',
  'focus-visible:border-slate-400',
),
```

`focusStyles.primary` (used on primary buttons) keeps `ring-primary` — intentional. The ring on a primary button matching the button's own brand color is the correct visual behavior.

---

### 7. `lib/design/card-system.ts`

Update the stale file-level comment:

```ts
// Before: "All card borders use warmPalette.border (warm-gray, not cool slate)."
// After:  "All card borders use warmPalette.border (slate-200)."
```

No other changes — the `warmPalette.border` import still works; only the values change (handled in step 5).

---

### 8. `components/answering-service/WizardProgress.tsx`

Wizard steps are utility chrome, not high-intent CTAs. Replace all warm/primary references with explicit slate classes.

**Step circle states:**
```tsx
{
  'bg-slate-600 border-slate-600 text-white': isCompleted,
  'bg-slate-600 border-slate-600 text-white ring-4 ring-slate-400/20': isCurrent,
  'border-slate-300 text-slate-400 bg-transparent': isPending,
}
```

**Connector line:**
```tsx
{
  'bg-slate-400': isCompleted,
  'bg-slate-200': !isCompleted,
}
```

**Step label text:**
```tsx
{
  'text-slate-700 font-medium': isCurrent,
  'text-slate-400': isPending || isCompleted,
}
```

---

### 9. `components/answering-service/DashboardSummaryCard.tsx`

```tsx
// Before
'cursor-pointer transition-all hover:border-bronze hover:shadow-md group-hover:border-bronze'

// After
'cursor-pointer transition-all hover:border-slate-300 hover:shadow-md group-hover:border-slate-300'
```

---

### 10. `components/answering-service/PHIToggleDemo.tsx`

```tsx
// Before
value ? 'border-bronze text-primary' : 'border-steel text-muted-foreground'

// After
value ? 'border-slate-400 text-slate-700' : 'border-slate-300 text-muted-foreground'
```

---

### 11. Update inline CSS var fallbacks — all 8 occurrences

Every place in the codebase that references `var(--portal-brand-color, #3b82f6)` must update the fallback from `#3b82f6` to `#334155`. There are 8 occurrences across 7 files:

**Components:**
- `SideNav.tsx` line 35 (backgroundColor)
- `SideNav.tsx` line 55 (color)
- `BottomNav.tsx` line 49 (color)
- `LoginForm.tsx` line 82 (backgroundColor)
- `DashboardCallVolume.tsx` line 36 (Sparkline color prop)

**Auth pages:**
- `app/(auth)/login/page.tsx` line 22 (backgroundColor)
- `app/(auth)/login/forgot-password/page.tsx` line 77 (backgroundColor)
- `app/(auth)/login/reset-password/page.tsx` line 81 (backgroundColor)

In normal operation `--portal-brand-color` is always injected at `:root` by `app/layout.tsx`, so these fallbacks only fire in isolated rendering contexts (tests, Storybook, or when `PORTAL_BRAND_COLOR` env var is unset). Without this fix, the default-state login flow renders Tailwind blue while the platform renders dark slate — a visually broken default.

---

## What Stays Unchanged

- `--portal-brand-color` inline style usage in `SideNav.tsx`, `BottomNav.tsx`, `LoginForm.tsx`, `DashboardCallVolume.tsx` — already correct
- `focusStyles.primary` in `motion-system.ts` — keeps `ring-primary`; brand-colored ring on a brand-colored button is intentional
- `microInteractions.navIcon` and `complexHovers.listCard` — `group-hover:text-primary` and `[&_svg]:group-hover:text-primary` stay; hover icon tints being brand-colored is correct
- Status color system (`statusColors`, `badgeVariants`) — emerald/amber/rose/blue, universal
- Shadow utilities (`shadow-institutional`, `premium-card`) — no color dependency
- `--color-steel` family in `globals.css` — neutral UI chrome, no brand meaning
- `borderStyles`, `shadowStyles` in `color-system.ts` — already slate-based
- Shadcn UI component files (`button.tsx`, `badge.tsx`, `input.tsx`, `checkbox.tsx`, `radio-group.tsx`) — auto-update via CSS vars, no direct changes needed

---

## Out of Scope

- `lib/design/ProgressRing.tsx` — has a `TODO: replace fallback hex` comment; minor edge case, deferred
- Dark mode — not in scope for this sprint
