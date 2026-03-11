# UI Color System Clean Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all gold/bronze/warm colour tokens from the codebase and replace them with a neutral slate system that works correctly for white-label deployment.

**Architecture:** `--portal-brand-color` (injected at `:root` from `PORTAL_BRAND_COLOR` env var) drives primary buttons and active nav. Slate-600 drives wizard steps. Slate-400 drives input focus rings and utility chrome. All warm/gold tokens are deleted.

**Tech Stack:** Next.js 15 App Router, Tailwind v4 (`@theme` block), shadcn/ui (CSS variables mode), TypeScript

---

## Chunk 1: CSS Foundation + Layout Injection

Changes to `globals.css`, `app/layout.tsx`, the two child layouts, and `lib/config/portal.ts`. These are prerequisites for all downstream work — getting the root tokens right first means the rest of the changes produce visibly correct results immediately.

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Modify: `app/(platform)/answering-service/layout.tsx`
- Modify: `app/(auth)/layout.tsx`
- Modify: `lib/config/portal.ts`

---

### Task 1: Clean `globals.css` — remove warm tokens, update primary/ring/focus

- [ ] **Step 1: Confirm what you're removing**

  Run to see the exact lines being deleted:
  ```bash
  grep -n "gunmetal\|bronze\|gold\|tactical" app/globals.css
  ```
  Expected: 10 lines covering `--color-gunmetal` (4 variants), `--color-bronze` (3 variants), `--color-gold`, `--color-tactical`.

- [ ] **Step 2: Remove warm token declarations from `@theme`**

  In `app/globals.css`, delete these 9 CSS declarations plus the 2 surrounding comment lines (11 lines total) from the `@theme` block:
  ```css
  /* Delete these lines entirely: */
  /* Brand Colors — Dark surfaces */
  --color-gunmetal: #1C1F26;
  --color-gunmetal-light: #2A2D35;
  --color-gunmetal-lighter: #3F4248;
  --color-gunmetal-lightest: #363B47;

  /* Brand Colors — Accent */
  --color-bronze: #A68A64;
  --color-bronze-light: #B89B75;
  --color-bronze-dark: #8a7354;
  --color-gold: #D4B483;
  --color-tactical: #2A453B;
  ```

- [ ] **Step 3: Update `--color-primary`, `--color-primary-foreground`, and `--color-ring`**

  In `app/globals.css`, find and replace:
  ```css
  /* Before */
  --color-primary: #A68A64;
  --color-primary-foreground: #1c1f26;
  ```
  ```css
  /* After */
  --color-primary: var(--portal-brand-color, #334155);
  --color-primary-foreground: #ffffff;
  ```

  Find and replace:
  ```css
  /* Before */
  --color-ring: #D4B483;
  ```
  ```css
  /* After */
  --color-ring: #94a3b8;
  ```

- [ ] **Step 4: Update `:focus-visible` rule**

  In `app/globals.css`, find and replace the entire `:focus-visible` block:
  ```css
  /* Before */
  :focus-visible {
    outline: 2px solid var(--color-gold);
    outline-offset: 2px;
    box-shadow: 0 0 0 4px rgba(28, 31, 38, 0.8);
  }
  ```
  ```css
  /* After */
  :focus-visible {
    outline: 2px solid var(--color-ring);
    outline-offset: 2px;
    box-shadow: 0 0 0 4px rgba(148, 163, 184, 0.2);
  }
  ```

- [ ] **Step 5: Verify no warm tokens remain**

  ```bash
  grep -n "gunmetal\|bronze\|gold\|tactical\|#A68A64\|#D4B483\|#B89B75\|#8a7354\|#1C1F26\|#2A453B" app/globals.css
  ```
  Expected: zero matches.

- [ ] **Step 6: Typecheck**

  ```bash
  npm run typecheck
  ```
  Expected: no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add app/globals.css
  git commit -m "style: remove warm tokens from globals.css, update primary/ring/focus to slate"
  ```

---

### Task 2: Move `--portal-brand-color` injection to `<head>` in root layout

The variable is currently set on layout `<div>`s. Radix UI portals (modals, dropdowns, etc.) render at `document.body` — outside those divs — so they never inherit it. Moving injection to `:root` via a `<style>` tag in `<head>` fixes this.

- [ ] **Step 1: Confirm current state of `app/layout.tsx`**

  ```bash
  cat app/layout.tsx
  ```
  Expected: a `<head>` block containing `<meta name="theme-color">` and `<link rel="apple-touch-icon">`. The file already imports `portalConfig`.

- [ ] **Step 2: Add `<style>` tag to `<head>` in `app/layout.tsx`**

  Find and replace in `app/layout.tsx`:
  ```tsx
  /* Before */
  <head>
    <meta name="theme-color" content={portalConfig.brandColor} />
    <link rel="apple-touch-icon" href="/icon-192.png" />
  </head>
  ```
  ```tsx
  /* After */
  <head>
    <meta name="theme-color" content={portalConfig.brandColor} />
    <link rel="apple-touch-icon" href="/icon-192.png" />
    <style>{`:root { --portal-brand-color: ${portalConfig.brandColor}; }`}</style>
  </head>
  ```

- [ ] **Step 3: Remove inline style prop from `app/(platform)/answering-service/layout.tsx`**

  Find and replace:
  ```tsx
  /* Before */
  <div
    className="min-h-screen bg-slate-50"
    style={{ '--portal-brand-color': portalConfig.brandColor } as React.CSSProperties}
  >
  ```
  ```tsx
  /* After */
  <div className="min-h-screen bg-slate-50">
  ```

  The `portalConfig` import at the top of this file can stay — it's still used for `portalConfig.name` passed to `SideNav`.

- [ ] **Step 4: Remove inline style prop and unused import from `app/(auth)/layout.tsx`**

  Find and replace the div:
  ```tsx
  /* Before */
  <div
    className="min-h-screen bg-slate-50 px-4 py-12"
    style={{ '--portal-brand-color': portalConfig.brandColor } as React.CSSProperties}
  >
  ```
  ```tsx
  /* After */
  <div className="min-h-screen bg-slate-50 px-4 py-12">
  ```

  `app/(auth)/layout.tsx` uses `portalConfig` only for the style prop — nowhere else. Remove its import too:
  ```tsx
  /* Delete this line: */
  import { portalConfig } from '@/lib/config/portal'
  ```

- [ ] **Step 5: Verify the style prop is fully removed**

  ```bash
  grep -rn "portal-brand-color" app/ --include="*.tsx" | grep "style="
  ```
  Expected: zero matches. (The `<style>` tag in `app/layout.tsx` is not a `style=` attribute so it won't appear.)

- [ ] **Step 6: Typecheck**

  ```bash
  npm run typecheck
  ```
  Expected: no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add app/layout.tsx "app/(platform)/answering-service/layout.tsx" "app/(auth)/layout.tsx"
  git commit -m "fix: inject --portal-brand-color at :root so Radix portals inherit it"
  ```

  Note: `app/(auth)/layout.tsx` has the `portalConfig` import removed in Step 4 — the typecheck in Step 6 confirms this is clean before committing.

---

### Task 3: Update `lib/config/portal.ts` default and add contrast comment

- [ ] **Step 1: Update `portal.ts`**

  Find and replace in `lib/config/portal.ts`:
  ```ts
  /* Before */
  brandColor: process.env.PORTAL_BRAND_COLOR ?? '#3b82f6',
  ```
  ```ts
  /* After */
  // PORTAL_BRAND_COLOR must be dark enough that white (#fff) text achieves 4.5:1 contrast.
  // Verify at: https://webaim.org/resources/contrastchecker/
  brandColor: process.env.PORTAL_BRAND_COLOR ?? '#334155',
  ```

- [ ] **Step 2: Verify**

  ```bash
  grep -n "3b82f6" lib/config/portal.ts
  ```
  Expected: zero matches.

- [ ] **Step 3: Typecheck**

  ```bash
  npm run typecheck
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add lib/config/portal.ts
  git commit -m "chore: update portal.ts brand color default to slate-700, add contrast constraint comment"
  ```

---

## Chunk 2: Design System Token Files

Changes to `lib/design/brand-tokens.ts`, `lib/design/color-system.ts`, `lib/design/motion-system.ts`, and `lib/design/card-system.ts`. These define the token layer that downstream components consume.

**Files:**
- Modify: `lib/design/brand-tokens.ts`
- Modify: `lib/design/color-system.ts`
- Modify: `lib/design/motion-system.ts`
- Modify: `lib/design/card-system.ts`

---

### Task 4: Rewrite `brand-tokens.ts` with neutral slate values

- [ ] **Step 1: Read the current file**

  ```bash
  cat lib/design/brand-tokens.ts
  ```
  Confirms 13 properties, all with TODO comments and warm/incorrect placeholder values.

- [ ] **Step 2: Replace the file contents**

  Full replacement for `lib/design/brand-tokens.ts`:
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

  **Removed vs before:** `accentWarm`, `accentWarmGradient` (no neutral analog), `sidebarDark`, `sidebarGradient` (defined but never imported outside this file).

- [ ] **Step 3: Verify warm values are gone**

  ```bash
  grep -n "d4b896\|f7f2ea\|e0d5c5\|1a4d2e\|1a2b3c\|070e1a\|accentWarm\|sidebarDark\|sidebarGradient" lib/design/brand-tokens.ts
  ```
  Expected: zero matches.

- [ ] **Step 4: Typecheck — confirm no consumers break**

  `brandTokens` is only imported by `color-system.ts`. After the next task removes that import, this step confirms nothing else broke in the meantime.

  ```bash
  npm run typecheck
  ```
  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add lib/design/brand-tokens.ts
  git commit -m "style: replace warm brand-tokens.ts placeholders with neutral slate values"
  ```

---

### Task 5: Update `color-system.ts` — warmPalette, remove dead code, fix buttonVariants

This task has four sub-changes applied to the same file. Do them in order.

- [ ] **Step 1: Read the file to orient yourself**

  ```bash
  cat lib/design/color-system.ts
  ```
  Note: line 12 has `import { brandTokens } from './brand-tokens'`. Lines ~200-246 have `marketingGradients`. Lines ~253-270 have `warmPalette`. Lines ~156-194 have `buttonVariants`.

- [ ] **Step 2: Remove the `brandTokens` import**

  Delete line 12:
  ```ts
  import { brandTokens } from './brand-tokens'
  ```

- [ ] **Step 3: Replace `warmPalette` with the new neutral values**

  Find and replace the entire `warmPalette` export (including its JSDoc):
  ```ts
  /* Before (entire block, ~lines 250-270) */
  /**
   * App background palette — for components rendered on the app background color.
   * Card borders, separators, and text on the app bg use these tokens.
   * DO NOT use border-slate-200 on the warm app bg — it reads too cool.
   */
  export const warmPalette = {
    /** Card border on app bg — use instead of border-slate-200 */
    border: `border-[${brandTokens.borderApp}]`,
    /** Inline borderColor value for style={{ borderColor }} contexts */
    borderColor: brandTokens.borderApp,
    /**
     * Page-level separator color (PageHeader bottom border).
     * Darker than borderApp to achieve sufficient contrast on the app background.
     * TODO: adjust to match your app background color — verify contrast is ~2.4:1.
     */
    separatorColor: '#a89b8e',
    /** Section separator (PageHeader bottom border, section dividers) */
    separator: `border-b pb-6 mb-6 border-[${brandTokens.borderApp}]`,
    /** Primary text on app bg (page titles) */
    textClass: 'text-stone-900',
    /** Secondary text on app bg (subtitles) */
    subtextClass: 'text-stone-500',
  } as const
  ```
  ```ts
  /* After */
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

- [ ] **Step 4: Delete the `marketingGradients` export**

  Find and delete the entire `marketingGradients` block — from the JSDoc comment (`/** Marketing page gradients...`) through the closing `} as const` on its last line. This is approximately lines 196–246 in the original file. It is never imported anywhere outside this file.

  Also update the file-level JSDoc at the very top of `color-system.ts`. Find and replace:
  ```ts
  /* Before */
   * universal — only replace the brand-specific values in warmPalette and marketingGradients.
  ```
  ```ts
  /* After */
   * universal — only replace the brand-specific values in warmPalette.
  ```

  After both edits, run:
  ```bash
  grep -n "marketingGradients" lib/design/color-system.ts
  ```
  Expected: zero matches.

- [ ] **Step 5: Fix `buttonVariants.primary`**

  Find and replace the `primary` entry inside `buttonVariants`:
  ```ts
  /* Before */
  primary: cn(
    'premium-button-primary',  // From globals.css (gradient + inset highlight)
    'text-white font-semibold',
    'hover:scale-[1.02]',
    'active:scale-[0.98]',
  ),
  ```
  ```ts
  /* After */
  primary: cn(
    'bg-primary text-primary-foreground',
    'hover:opacity-90',
    'hover:scale-[1.02]',
    'active:scale-[0.98]',
    'transition-all duration-200 ease-out',
  ),
  ```

  Note: `premium-button-primary` was referenced here but never existed in `globals.css` — this fixes a pre-existing silent bug.

- [ ] **Step 6: Verify**

  ```bash
  grep -n "brandTokens\|marketingGradients\|premium-button-primary\|stone-900\|stone-500\|a89b8e" lib/design/color-system.ts
  ```
  Expected: zero matches.

- [ ] **Step 7: Typecheck**

  ```bash
  npm run typecheck
  ```
  Expected: no errors. The 4 files that import `warmPalette` (`card-system.ts`, `overlay-system.ts`, `table-system.ts`, `shell-system.ts`) will automatically pick up the new values — no changes needed in those files.

- [ ] **Step 8: Commit**

  ```bash
  git add lib/design/color-system.ts
  git commit -m "style: neutralize warmPalette, remove dead marketingGradients, fix broken buttonVariants.primary"
  ```

---

### Task 6: Fix `focusStyles.input` in `motion-system.ts`

Under the hybrid approach, input focus rings are utility chrome (slate), not brand color. Only primary *button* focus rings are intentionally brand-colored.

- [ ] **Step 1: Find and replace `focusStyles.input`**

  In `lib/design/motion-system.ts`, find and replace:
  ```ts
  /* Before */
  // Input focus
  input: cn(
    'focus-visible:outline-none',
    'focus-visible:ring-2 focus-visible:ring-primary',
    'focus-visible:border-primary',
  ),
  ```
  ```ts
  /* After */
  // Input focus
  input: cn(
    'focus-visible:outline-none',
    'focus-visible:ring-2 focus-visible:ring-slate-400',
    'focus-visible:border-slate-400',
  ),
  ```

  Do **not** change `focusStyles.primary` — `ring-primary` on primary buttons is intentional (brand-colored ring on a brand-colored button).

- [ ] **Step 2: Verify**

  ```bash
  grep -n "ring-primary\|border-primary" lib/design/motion-system.ts
  ```
  Expected: exactly 1 match — `ring-primary` inside `focusStyles.primary`. `border-primary` should no longer appear anywhere in the file.

- [ ] **Step 3: Typecheck**

  ```bash
  npm run typecheck
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add lib/design/motion-system.ts
  git commit -m "style: input focus ring changed from ring-primary to ring-slate-400"
  ```

---

### Task 7: Update stale comment in `card-system.ts`

- [ ] **Step 1: Find and replace the stale comment**

  In `lib/design/card-system.ts`, find and replace the file-level comment:
  ```ts
  /* Before */
  * All card borders use warmPalette.border (warm-gray, not cool slate).
  ```
  ```ts
  /* After */
  * All card borders use warmPalette.border (slate-200).
  ```

- [ ] **Step 2: Verify**

  ```bash
  grep -n "warm-gray" lib/design/card-system.ts
  ```
  Expected: zero matches.

- [ ] **Step 3: Commit**

  ```bash
  git add lib/design/card-system.ts
  git commit -m "chore: update stale card-system.ts comment"
  ```

---

## Chunk 3: Components + Inline Fallback Updates

Changes to three components with hardcoded warm class names, and 8 inline CSS var fallback strings across 7 files.

**Files:**
- Modify: `components/answering-service/WizardProgress.tsx`
- Modify: `components/answering-service/DashboardSummaryCard.tsx`
- Modify: `components/answering-service/PHIToggleDemo.tsx`
- Modify: `components/answering-service/SideNav.tsx`
- Modify: `components/answering-service/BottomNav.tsx`
- Modify: `components/answering-service/auth/LoginForm.tsx`
- Modify: `components/answering-service/DashboardCallVolume.tsx`
- Modify: `app/(auth)/login/page.tsx`
- Modify: `app/(auth)/login/forgot-password/page.tsx`
- Modify: `app/(auth)/login/reset-password/page.tsx`

---

### Task 8: Fix `WizardProgress.tsx`

Wizard progress steps are utility chrome. Replace all `bg-primary`, `border-bronze`, and `border-steel` class references with explicit slate classes.

- [ ] **Step 1: Read the current file**

  ```bash
  cat components/answering-service/WizardProgress.tsx
  ```
  Confirm: lines 22–25 have the step circle `cn()` call using `bg-primary`, `border-bronze`, `ring-bronze/20`, and `border-steel`. Line 47 uses `bg-primary` on the connector. Lines 36–39 use `text-primary` and `text-muted-foreground` on labels.

- [ ] **Step 2: Replace the step circle `cn()` block**

  Find and replace:
  ```tsx
  /* Before */
  className={cn(
    'w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors',
    {
      'bg-primary border-bronze text-foreground': isCompleted,
      'bg-primary border-bronze text-foreground ring-4 ring-bronze/20': isCurrent,
      'border-steel text-muted-foreground bg-transparent': isPending,
    }
  )}
  ```
  ```tsx
  /* After */
  className={cn(
    'w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors',
    {
      'bg-slate-600 border-slate-600 text-white': isCompleted,
      'bg-slate-600 border-slate-600 text-white ring-4 ring-slate-400/20': isCurrent,
      'border-slate-300 text-slate-400 bg-transparent': isPending,
    }
  )}
  ```

- [ ] **Step 3: Replace the step label `cn()` block**

  Find and replace:
  ```tsx
  /* Before */
  className={cn('mt-2 text-xs text-center max-w-[100px]', {
    'text-primary font-medium': isCurrent,
    'text-muted-foreground': isPending || isCompleted,
  })}
  ```
  ```tsx
  /* After */
  className={cn('mt-2 text-xs text-center max-w-[100px]', {
    'text-slate-700 font-medium': isCurrent,
    'text-slate-400': isPending || isCompleted,
  })}
  ```

- [ ] **Step 4: Replace the connector line `cn()` block**

  Find and replace:
  ```tsx
  /* Before */
  className={cn('h-0.5 flex-1 mx-2 transition-colors', {
    'bg-primary': isCompleted,
    'bg-steel': !isCompleted,
  })}
  ```
  ```tsx
  /* After */
  className={cn('h-0.5 flex-1 mx-2 transition-colors', {
    'bg-slate-400': isCompleted,
    'bg-slate-200': !isCompleted,
  })}
  ```

- [ ] **Step 5: Verify no warm/brand tokens remain**

  ```bash
  grep -n "bg-primary\|border-bronze\|ring-bronze\|border-steel\|bg-steel\|text-primary" components/answering-service/WizardProgress.tsx
  ```
  Expected: zero matches.

- [ ] **Step 6: Typecheck**

  ```bash
  npm run typecheck
  ```
  Expected: no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add components/answering-service/WizardProgress.tsx
  git commit -m "style: WizardProgress steps changed from brand/bronze to slate utility chrome"
  ```

---

### Task 9: Fix `DashboardSummaryCard.tsx`

- [ ] **Step 1: Find and replace**

  In `components/answering-service/DashboardSummaryCard.tsx`, find and replace:
  ```tsx
  /* Before */
  <Card className={clickable ? 'cursor-pointer transition-all hover:border-bronze hover:shadow-md group-hover:border-bronze' : ''}>
  ```
  ```tsx
  /* After */
  <Card className={clickable ? 'cursor-pointer transition-all hover:border-slate-300 hover:shadow-md group-hover:border-slate-300' : ''}>
  ```

- [ ] **Step 2: Verify**

  ```bash
  grep -n "bronze" components/answering-service/DashboardSummaryCard.tsx
  ```
  Expected: zero matches.

- [ ] **Step 3: Commit**

  ```bash
  git add components/answering-service/DashboardSummaryCard.tsx
  git commit -m "style: DashboardSummaryCard hover border changed from bronze to slate-300"
  ```

---

### Task 10: Fix `PHIToggleDemo.tsx`

- [ ] **Step 1: Find and replace**

  In `components/answering-service/PHIToggleDemo.tsx`, find and replace:
  ```tsx
  /* Before */
  value ? 'border-bronze text-primary' : 'border-steel text-muted-foreground'
  ```
  ```tsx
  /* After */
  value ? 'border-slate-400 text-slate-700' : 'border-slate-300 text-muted-foreground'
  ```

- [ ] **Step 2: Verify**

  ```bash
  grep -n "bronze\|border-steel" components/answering-service/PHIToggleDemo.tsx
  ```
  Expected: zero matches.

- [ ] **Step 3: Commit**

  ```bash
  git add components/answering-service/PHIToggleDemo.tsx
  git commit -m "style: PHIToggleDemo active state changed from bronze to slate-400"
  ```

---

### Task 11: Update all 8 inline `--portal-brand-color` fallbacks

Every inline `var(--portal-brand-color, #3b82f6)` must change its fallback from `#3b82f6` (blue) to `#334155` (slate-700). There are 8 occurrences across 7 files.

- [ ] **Step 1: Confirm all 8 occurrences**

  ```bash
  grep -rn "portal-brand-color.*3b82f6" . --include="*.tsx" | grep -v node_modules | grep -v ".next"
  ```
  Expected: 8 lines across these files:
  - `components/answering-service/SideNav.tsx` (2 lines)
  - `components/answering-service/BottomNav.tsx` (1 line)
  - `components/answering-service/auth/LoginForm.tsx` (1 line)
  - `components/answering-service/DashboardCallVolume.tsx` (1 line)
  - `app/(auth)/login/page.tsx` (1 line)
  - `app/(auth)/login/forgot-password/page.tsx` (1 line)
  - `app/(auth)/login/reset-password/page.tsx` (1 line)

- [ ] **Step 2: Replace in each file**

  In `components/answering-service/SideNav.tsx` — replace both occurrences:
  ```tsx
  /* Before */ 'var(--portal-brand-color, #3b82f6)'
  /* After  */ 'var(--portal-brand-color, #334155)'
  ```

  In `components/answering-service/BottomNav.tsx`:
  ```tsx
  /* Before */ 'var(--portal-brand-color, #3b82f6)'
  /* After  */ 'var(--portal-brand-color, #334155)'
  ```

  In `components/answering-service/auth/LoginForm.tsx`:
  ```tsx
  /* Before */ 'var(--portal-brand-color, #3b82f6)'
  /* After  */ 'var(--portal-brand-color, #334155)'
  ```

  In `components/answering-service/DashboardCallVolume.tsx` (this one is inside a JSX prop, not a `style` object — same string substitution):
  ```tsx
  /* Before */ color="var(--portal-brand-color, #3b82f6)"
  /* After  */ color="var(--portal-brand-color, #334155)"
  ```

  In `app/(auth)/login/page.tsx`:
  ```tsx
  /* Before */ backgroundColor: 'var(--portal-brand-color, #3b82f6)'
  /* After  */ backgroundColor: 'var(--portal-brand-color, #334155)'
  ```

  In `app/(auth)/login/forgot-password/page.tsx`:
  ```tsx
  /* Before */ backgroundColor: 'var(--portal-brand-color, #3b82f6)'
  /* After  */ backgroundColor: 'var(--portal-brand-color, #334155)'
  ```

  In `app/(auth)/login/reset-password/page.tsx`:
  ```tsx
  /* Before */ backgroundColor: 'var(--portal-brand-color, #3b82f6)'
  /* After  */ backgroundColor: 'var(--portal-brand-color, #334155)'
  ```

- [ ] **Step 3: Verify all 8 are gone**

  ```bash
  grep -rn "portal-brand-color.*3b82f6" . --include="*.tsx" | grep -v node_modules | grep -v ".next"
  ```
  Expected: zero matches.

- [ ] **Step 4: Verify all 8 replacements landed**

  ```bash
  grep -rn "portal-brand-color.*334155" . --include="*.tsx" | grep -v node_modules | grep -v ".next"
  ```
  Expected: 8 matches.

- [ ] **Step 5: Typecheck**

  ```bash
  npm run typecheck
  ```
  Expected: no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add \
    components/answering-service/SideNav.tsx \
    components/answering-service/BottomNav.tsx \
    components/answering-service/auth/LoginForm.tsx \
    components/answering-service/DashboardCallVolume.tsx \
    "app/(auth)/login/page.tsx" \
    "app/(auth)/login/forgot-password/page.tsx" \
    "app/(auth)/login/reset-password/page.tsx"
  git commit -m "style: update portal-brand-color fallback from blue to slate-700 across all 8 occurrences"
  ```

---

### Task 12: Final verification sweep

- [ ] **Step 1: Confirm zero remaining warm token class references**

  ```bash
  grep -rn "border-bronze\|text-bronze\|bg-bronze\|ring-bronze\|border-gold\|text-gold\|bg-gold\|ring-gold" \
    components/ app/ \
    --include="*.tsx" --include="*.ts" \
    | grep -v node_modules | grep -v ".next"
  ```
  Expected: zero matches.

  Note: `text-primary` is intentionally excluded from this sweep. After Chunk 1, `--color-primary` resolves to `var(--portal-brand-color, #334155)` — slate, not gold. Remaining `text-primary` usages in icon components and shadcn base files are correct and expected.

- [ ] **Step 2: Confirm zero warm hex values in source**

  ```bash
  grep -rn "#A68A64\|#D4B483\|#B89B75\|#8a7354\|#f7f2ea\|#e0d5c5\|#a89b8e\|#d4b896" \
    app/ lib/ components/ \
    --include="*.tsx" --include="*.ts" --include="*.css" \
    | grep -v node_modules | grep -v ".next"
  ```
  Expected: zero matches.

- [ ] **Step 3: Full typecheck**

  ```bash
  npm run typecheck
  ```
  Expected: no errors.

- [ ] **Step 4: Run tests**

  ```bash
  npm test
  ```
  Expected: all existing tests pass (no logic was changed — only class strings and CSS token values).

- [ ] **Step 5: Visual check**

  Start the dev server:
  ```bash
  npm run dev
  ```
  Navigate to `/login`. Verify:
  - Login button renders dark slate (not gold, not blue)
  - Tab through the form — focus rings are slate-grey (not gold)

  Navigate to the dashboard (if accessible without credentials, or use seed data). Verify:
  - Primary buttons render in slate
  - No gold or bronze appears anywhere on hover, focus, or active states

- [ ] **Step 6: Tag the sprint complete**

  ```bash
  git tag ui-color-system-clean
  ```
