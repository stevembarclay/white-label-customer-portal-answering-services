# E2E Test Suite — Design Spec

**Date:** 2026-03-12
**Status:** Approved

## Overview

Full end-to-end test suite for the Answering Service Portal, running against production (`https://answering.stintwell.com`) on demand. Tests include mutations (writes to the live DB); no cleanup is required between runs. Tests use Playwright with saved auth state so no test has to perform a login itself (except the auth tests, which test the login flow directly).

## Configuration

`playwright.config.ts` is updated to support three projects:

- **setup** — runs `auth.setup.ts` first; saves `storageState` for the client and operator roles to `.auth/client.json` and `.auth/operator.json`
- **client-tests** — depends on setup; loads `.auth/client.json`; runs all `tests/e2e/client/**`
- **operator-tests** — depends on setup; loads `.auth/operator.json`; runs all `tests/e2e/operator/**`

Auth tests (`tests/e2e/auth.e2e.ts`) run without any stored state — they test the login flow itself.

`PLAYWRIGHT_BASE_URL` defaults to `http://localhost:3000`. To run against production, set it to `https://answering.stintwell.com`. No other changes needed.

Credentials are read from `.env.test` (already present) via `dotenv`.

## File Structure

```
tests/e2e/
  auth.setup.ts                  # saves storageState for client + operator
  auth.e2e.ts                    # login, logout, failed login, unauthenticated redirects
  pages/
    LoginPage.ts                 # existing — unchanged
    ClientPortalPage.ts          # existing — add on-call, wizard, settings nav methods
    OperatorPortalPage.ts        # existing — add billing-templates, client detail nav
    OnCallPage.ts                # new — shift builder, contact book interactions
    WizardPage.ts                # new — step navigation
    SettingsPage.ts              # new — save settings, API key create/revoke
    BillingPage.ts               # new — invoice table, usage estimate assertions
    OperatorClientsPage.ts       # new — client list, open detail
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
    api-webhooks.e2e.ts
    settings.e2e.ts
    mobile.e2e.ts
```

## Test Coverage

### Auth (`auth.e2e.ts` — no stored state)

| Test | Assertion |
|------|-----------|
| Valid client login | Redirects to `/answering-service/dashboard` |
| Valid operator login | Redirects to `/operator/clients` |
| Wrong password | Error message visible; no crash |
| Client sign-out | Returns to `/login` |
| Operator sign-out | Returns to `/login` |
| Unauthenticated → client route | Redirects to `/login` |
| Unauthenticated → operator route | Redirects to `/login` |

### Client Portal

**dashboard.e2e.ts**
- Page loads without JS errors
- Key UI elements (stats, activity feed) are visible

**messages.e2e.ts**
- Message list renders with at least one row
- Clicking a message opens a transcript view

**billing.e2e.ts**
- Invoice table is visible
- Running billing estimate is visible

**settings.e2e.ts**
- Page loads
- Can update a field and save (e.g. business name)
- Can create an API key — key appears in the list
- Can revoke the created key — key no longer appears

**on-call.e2e.ts**
- Schedule renders
- Can add a shift — shift appears in the schedule
- Can add a contact — contact appears in the contact list

**wizard.e2e.ts**
- Wizard page loads
- Can navigate through at least steps 1–3 using Next button

**mobile.e2e.ts** (viewport: 390×844)
- Client portal renders at mobile size — BottomNav visible, no overflow errors

### Operator Portal

**clients.e2e.ts**
- Client list loads
- "Riverside Law Group" is visible
- Clicking into a client opens the detail page

**clients.e2e.ts (detail)**
- Who to Call card is visible

**usage.e2e.ts**
- Page loads without error

**billing-templates.e2e.ts**
- Page loads without error

**api-webhooks.e2e.ts**
- Page loads
- Can create an API key — key appears in list

**settings.e2e.ts**
- Page loads without error

**mobile.e2e.ts** (viewport: 390×844)
- Operator portal renders at mobile size without layout breakage

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
- Firefox / Safari / mobile device projects (Chromium only for now)
- Magic link / forgot password flows (not testable without email access)
