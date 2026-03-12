# E2E Test Suite — Design Spec

**Date:** 2026-03-12
**Status:** Approved

## Overview

Full end-to-end test suite for the Answering Service Portal, running against production (`https://answering.stintwell.com`) on demand. Tests include mutations (writes to the live DB); no cleanup is required between runs. Tests use Playwright with saved auth state so no test has to perform a login itself (except the auth tests, which test the login flow directly).

## Configuration

`playwright.config.ts` is **replaced** (not merely updated). The new config defines four projects with explicit `testMatch` per project:

| Project | `testMatch` | `storageState` | `dependsOn` |
|---------|------------|----------------|-------------|
| `setup` | `**/auth.setup.ts` | none | none |
| `auth-tests` | `**/auth.e2e.ts` | none | none (runs concurrently with setup — safe because Supabase supports multiple simultaneous sessions per user, and `signOut` defaults to `scope: 'local'`, invalidating only the current page context's token, not the one being saved by `setup`) |
| `client-tests` | `tests/e2e/client/**/*.e2e.ts` | `.auth/client.json` | `setup` |
| `operator-tests` | `tests/e2e/operator/**/*.e2e.ts` | `.auth/operator.json` | `setup` |

The global `testMatch` at the top level of the config is **removed** — each project uses its own pattern.

The `webServer` block (which starts a local dev server) is **omitted** from the new config. Tests always hit `PLAYWRIGHT_BASE_URL` directly; no local server is started.

`PLAYWRIGHT_BASE_URL` defaults to `http://localhost:3000`. To run against production, set it to `https://answering.stintwell.com`.

`dotenv.config({ path: '.env.test' })` is called at the top of `auth.setup.ts` (the only file that reads credentials). Individual test files do not call `dotenv.config()`.

Add `.auth/` to `.gitignore` — the saved session token files must not be committed.

## Credentials

Stored in `.env.test` (already present):

```
TEST_CLIENT_EMAIL=demo@example.com
TEST_CLIENT_PASSWORD=demo-password-2026
TEST_OPERATOR_EMAIL=operator@example.com
TEST_OPERATOR_PASSWORD=operator-password-2026
```

## Migration From Existing Tests

The existing files `tests/e2e/client-portal.e2e.ts` and `tests/e2e/operator-portal.e2e.ts` are **deleted**. Their coverage is superseded by the new feature-based files. They cannot coexist with the new structure because they call `dotenv.config()` inline and log in directly (bypassing saved auth state).

## File Structure

```
.auth/
  client.json                    # saved storageState — git-ignored
  operator.json                  # saved storageState — git-ignored
tests/e2e/
  auth.setup.ts                  # saves storageState for client + operator
  auth.e2e.ts                    # login, logout, failed login, unauthenticated redirects
  pages/
    LoginPage.ts                 # existing — add signInRaw() for failed-login test (no URL wait)
    ClientPortalPage.ts          # existing — add gotoSetup(), gotoOnCall() methods
    OperatorPortalPage.ts        # existing — add gotoBillingTemplates() method only; do not add gotoClientDetail(id) — detail tests navigate via OperatorClientsPage.clickFirstClient()
    OnCallPage.ts                # new — shift builder, contact book interactions
    WizardPage.ts                # new — step navigation
    SettingsPage.ts              # new — save settings, API key create/revoke
    BillingPage.ts               # new — invoice table, usage estimate assertions
    OperatorClientsPage.ts       # new — clickFirstClient() navigates to /operator/clients/[id]
  client/
    dashboard.e2e.ts
    messages.e2e.ts
    billing.e2e.ts
    settings.e2e.ts
    on-call.e2e.ts
    wizard.e2e.ts
    mobile.e2e.ts
  operator/
    clients.e2e.ts
    usage.e2e.ts
    billing-templates.e2e.ts
    operator-api-keys.e2e.ts     # tests the ApiKeyManager on /operator/api-webhooks; named for what it tests, not the route
    settings.e2e.ts
    mobile.e2e.ts
```

## Page Object Notes

### LoginPage additions
Add `signInRaw(email, password)` — fills the form and clicks Sign in but does **not** call `waitForURL`. Used exclusively by the failed-login test so it does not hang waiting for a navigation that never happens.

Note: the existing `signInAsClient()` and `signInAsOperator()` methods have hardcoded credential fallbacks matching `.env.test`. This means tests will still work if `dotenv.config()` is not called. This is acceptable; the fallbacks are intentional and match production demo values.

### OperatorClientsPage — client detail navigation
The operator client detail tests navigate by clicking through from the client list (not by hard-coded ID). `OperatorClientsPage` provides a `clickFirstClient()` method that clicks the first row and waits for navigation to `/operator/clients/[id]`.

## Console Error Checking

Any test that asserts "no console errors" does so by attaching a `page.on('console')` listener before navigation and asserting no messages with level `error` were emitted. This pattern applies to: `dashboard.e2e.ts`, `usage.e2e.ts`, `billing-templates.e2e.ts`, `settings.e2e.ts` (both roles), and both `mobile.e2e.ts` files.

## Pre-existing App Bug (Non-Blocking)

`setup/page.tsx` contains `redirect('/auth/login')` for unauthenticated access. The route `/auth/login` does not exist — the correct route is `/login`. This means an unauthenticated user hitting `/answering-service/setup` gets a 404 in production. Tests are unaffected (they use saved auth state), but if a test fails with an unexpected 404, this is the likely cause. This bug is not fixed as part of this suite.

## Test Coverage

### Auth (`auth.e2e.ts` — no stored state)

| Test | Assertion |
|------|-----------|
| Valid client login | Redirects to `/answering-service/dashboard` |
| Valid operator login | Redirects to `/operator/clients` |
| Wrong password | Uses `signInRaw()`; error message text visible on page; URL stays at `/login` |
| Client sign-out | Returns to `/login` |
| Operator sign-out | Returns to `/login` |
| Unauthenticated → `/answering-service/dashboard` | Redirects to `/login` |
| Unauthenticated → `/operator/clients` | Redirects to `/login` |

### Client Portal

**dashboard.e2e.ts** (route: `/answering-service/dashboard`)
- Page loads, no console errors at `error` level
- At least one visible heading or stat element is present

**messages.e2e.ts** (route: `/answering-service/messages`)
- Message list renders with at least one row
- Clicking a message opens a transcript view

**billing.e2e.ts** (route: `/answering-service/billing`)
- Invoice table is visible
- Running billing estimate element is visible

**settings.e2e.ts** (route: `/answering-service/settings`)
- The "Settings" `h1` heading is visible
- The "API Keys" `h2` heading is visible
- Can create an API key — key row appears in the list (identified by the key label)
- Can revoke the created key — key row is removed
- Note: there is no business name field on this page; the page is API key management only

**on-call.e2e.ts** (route: `/answering-service/on-call`)
- The "Who to Call" heading is visible (actual `h1` text in `on-call/page.tsx`)
- The visible tab text "Shifts" is present (assert by visible label text, not by `value="shifts"` attribute)
- **Test ordering within this file matters**: the "add a contact" test must run before the "add a shift" test. `ShiftBuilder` requires at least one contact to be selected in its escalation step (`handleSave` rejects if `steps.some(s => !s.contactId)`). A freshly added contact from the contacts test satisfies this requirement.
- Can add a contact — contact name is visible in the contacts list (assert existence, not count)
- Can add a shift — opens the shift Sheet, fills name, selects at least one day, selects the contact added above from the escalation dropdown, submits; new shift entry is visible in the schedule (assert existence, not count — shifts accumulate across runs)

**wizard.e2e.ts** (route: `/answering-service/setup`)
- The `PathSelector` gate may or may not appear depending on whether the demo user's session has a saved path. The test must handle both cases:
  1. If a "Self-Serve" button is visible on load, click it
  2. Assert the "Profile" step card title is visible (step 1)
  3. Click "Next →" and assert step 2 content is visible
  4. Click "Next →" again and assert step 3 content is visible
- Note: `setup/page.tsx` redirects unauthenticated users to `/auth/login` (a 404 in production — pre-existing bug). Tests use saved auth state so this is never triggered, but note it when debugging unexpected failures on this route.

**mobile.e2e.ts** (viewport: 390×844, route: `/answering-service/dashboard`)
- Client portal renders at mobile size — BottomNav is visible
- No console errors at `error` level

### Operator Portal

**clients.e2e.ts** (route: `/operator/clients`)
- Client list loads
- "Riverside Law Group" text is visible
- `clickFirstClient()` navigates to `/operator/clients/[id]`
- On the detail page, the text "Who to Call" is visible (it is an `h3` inside a card, not an `h1` — assert by visible text, not heading level)

**usage.e2e.ts** (route: `/operator/usage`)
- Page loads, no console errors at `error` level

**billing-templates.e2e.ts** (route: `/operator/billing-templates`)
- Page loads, no console errors at `error` level

**operator-api-keys.e2e.ts** (route: `/operator/api-webhooks`)
- Page loads
- Can create an operator API key — key row appears in the table
- Can revoke the created key — key row is removed (mirrors client settings test; prevents orphaned keys accumulating across runs)
- Note: webhook creation is out of scope; this file only covers the `ApiKeyManager` section of the page

**settings.e2e.ts** (route: `/operator/settings`)
- Page loads, no console errors at `error` level

**mobile.e2e.ts** (viewport: 390×844, route: `/operator/clients`)
- Operator portal renders at mobile size without layout breakage
- No console errors at `error` level

## Running the Suite

```bash
# Against production
PLAYWRIGHT_BASE_URL=https://answering.stintwell.com npx playwright test

# Single feature
PLAYWRIGHT_BASE_URL=https://answering.stintwell.com npx playwright test tests/e2e/client/on-call.e2e.ts

# View report
npx playwright show-report
```

## Out of Scope

- CI integration (on-demand only)
- Test data cleanup (demo data is allowed to accumulate)
- Firefox / Safari projects (Chromium only for now)
- Magic link / forgot password flows (not testable without email access)
- Webhook creation (tested manually; operator API key creation covers the api-webhooks page)
