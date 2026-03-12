# E2E Test Suite Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the thin existing Playwright smoke tests with a full feature-level E2E suite that runs against production (`https://answering.stintwell.com`) on demand.

**Architecture:** Four Playwright projects (setup, auth-tests, client-tests, operator-tests) with saved auth state so only `auth.setup.ts` needs to log in. Feature-based test files under `tests/e2e/client/` and `tests/e2e/operator/`. Page objects encapsulate selectors.

**Tech Stack:** Playwright, TypeScript, dotenv, Supabase (production), Vercel (production host)

---

## Chunk 1: Infrastructure

### Task 1: Replace playwright.config.ts

**Files:**
- Modify: `playwright.config.ts`

- [ ] **Step 1: Replace the entire file**

```typescript
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 60_000,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: '**/auth.setup.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'auth-tests',
      testMatch: '**/auth.e2e.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'client-tests',
      testMatch: 'tests/e2e/client/**/*.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/client.json',
      },
      dependencies: ['setup'],
    },
    {
      name: 'operator-tests',
      testMatch: 'tests/e2e/operator/**/*.e2e.ts',
      use: {
        ...devices['Desktop Chrome'],
        storageState: '.auth/operator.json',
      },
      dependencies: ['setup'],
    },
  ],
})
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: no errors

---

### Task 2: Update .gitignore and create .auth directory

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add .auth/*.json to .gitignore**

Append to `.gitignore`:
```
.auth/*.json
```

Note: use `.auth/*.json` not `.auth/` — a directory-level ignore would prevent git from tracking anything inside `.auth/`, but we still need to create the directory. Ignoring only the JSON files is correct.

- [ ] **Step 2: Create the .auth directory**

Playwright writes the auth state files itself when `storageState` is used. The directory must exist before setup runs:

```bash
mkdir -p .auth
```

This directory is never committed — it only needs to exist locally before running the suite.

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts .gitignore
git commit -m "chore: replace playwright config with 4-project setup, ignore .auth/*.json"
```

---

### Task 3: Delete old test files

**Files:**
- Delete: `tests/e2e/client-portal.e2e.ts`
- Delete: `tests/e2e/operator-portal.e2e.ts`

These files call `dotenv.config()` inline and log in directly, which conflicts with the new saved-state architecture.

- [ ] **Step 1: Delete the files**

```bash
rm tests/e2e/client-portal.e2e.ts tests/e2e/operator-portal.e2e.ts
```

- [ ] **Step 2: Commit**

```bash
git add -u
git commit -m "chore: remove old flat e2e test files superseded by feature-based suite"
```

---

### Task 4: Create auth.setup.ts

**Files:**
- Create: `tests/e2e/auth.setup.ts`

This file runs once before `client-tests` and `operator-tests`. It logs in as each role and saves the session cookie to `.auth/client.json` and `.auth/operator.json`.

- [ ] **Step 1: Create the file**

```typescript
import * as path from 'path'
import * as dotenv from 'dotenv'
import { test as setup } from '@playwright/test'

dotenv.config({ path: path.resolve(process.cwd(), '.env.test') })

const CLIENT_AUTH_FILE = '.auth/client.json'
const OPERATOR_AUTH_FILE = '.auth/operator.json'

setup('save client auth state', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(
    process.env.TEST_CLIENT_EMAIL ?? 'demo@example.com',
  )
  await page.getByLabel('Password').fill(
    process.env.TEST_CLIENT_PASSWORD ?? 'demo-password-2026',
  )
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await page.context().storageState({ path: CLIENT_AUTH_FILE })
})

setup('save operator auth state', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(
    process.env.TEST_OPERATOR_EMAIL ?? 'operator@example.com',
  )
  await page.getByLabel('Password').fill(
    process.env.TEST_OPERATOR_PASSWORD ?? 'operator-password-2026',
  )
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await page.context().storageState({ path: OPERATOR_AUTH_FILE })
})
```

- [ ] **Step 2: Run setup against production to verify auth state is saved**

```bash
PLAYWRIGHT_BASE_URL=https://answering.stintwell.com npx playwright test --project=setup
```

Expected: PASS (2 passing). Verify `.auth/client.json` and `.auth/operator.json` were created.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/auth.setup.ts
git commit -m "test: add auth.setup.ts to save storageState for client and operator"
```

---

## Chunk 2: Page Objects

### Task 5: Update existing page objects

**Files:**
- Modify: `tests/e2e/pages/LoginPage.ts`
- Modify: `tests/e2e/pages/ClientPortalPage.ts`
- Modify: `tests/e2e/pages/OperatorPortalPage.ts`

- [ ] **Step 1: Add signInRaw to LoginPage**

Add after the existing `signInAsOperator()` method in `tests/e2e/pages/LoginPage.ts`:

```typescript
async signInRaw(email: string, password: string) {
  await this.page.getByLabel('Email address').fill(email)
  await this.page.getByLabel('Password').fill(password)
  await this.page.getByRole('button', { name: 'Sign in' }).click()
  // No waitForURL — caller handles assertion (used for failed-login test)
}
```

- [ ] **Step 2: Add gotoSetup and gotoOnCall to ClientPortalPage**

Add to `tests/e2e/pages/ClientPortalPage.ts`:

```typescript
async gotoSetup() {
  await this.page.goto('/answering-service/setup')
}

async gotoOnCall() {
  await this.page.goto('/answering-service/on-call')
}
```

- [ ] **Step 3: Add gotoBillingTemplates to OperatorPortalPage**

Add to `tests/e2e/pages/OperatorPortalPage.ts`:

```typescript
async gotoBillingTemplates() {
  await this.page.goto('/operator/billing-templates')
}
```

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/pages/
git commit -m "test: extend LoginPage, ClientPortalPage, OperatorPortalPage with new nav methods"
```

---

### Task 6: Create new page objects

**Files:**
- Create: `tests/e2e/pages/BillingPage.ts`
- Create: `tests/e2e/pages/SettingsPage.ts`
- Create: `tests/e2e/pages/OnCallPage.ts`
- Create: `tests/e2e/pages/WizardPage.ts`
- Create: `tests/e2e/pages/OperatorClientsPage.ts`

- [ ] **Step 1: Create BillingPage.ts**

```typescript
import type { Page } from '@playwright/test'

export class BillingPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/answering-service/billing')
  }

  pastInvoicesHeading() {
    return this.page.getByRole('heading', { name: 'Past invoices' })
  }

  runningEstimate() {
    // The running estimate card contains the text "Running estimate"
    return this.page.getByText('Running estimate').first()
  }
}
```

- [ ] **Step 2: Create SettingsPage.ts**

```typescript
import type { Page } from '@playwright/test'

export class SettingsPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/answering-service/settings')
  }

  keyLabelInput() {
    return this.page.getByPlaceholder('Key label')
  }

  createKeyButton() {
    return this.page.getByRole('button', { name: 'Create key' })
  }

  revokeButton(label: string) {
    // Find the list item containing the key label, then find Revoke within it
    return this.page.getByText(label).locator('..').locator('..').getByRole('button', { name: 'Revoke' })
  }

  keyLabelText(label: string) {
    return this.page.getByText(label)
  }
}
```

- [ ] **Step 3: Create OnCallPage.ts**

```typescript
import type { Page } from '@playwright/test'

export class OnCallPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/answering-service/on-call')
  }

  heading() {
    return this.page.getByRole('heading', { name: 'Who to Call' })
  }

  shiftsTab() {
    return this.page.getByRole('tab', { name: 'Shifts' })
  }

  contactsTab() {
    return this.page.getByRole('tab', { name: 'Contacts' })
  }

  addShiftButton() {
    return this.page.getByRole('button', { name: '+ Add shift' })
  }

  addContactButton() {
    return this.page.getByRole('button', { name: '+ Add contact' })
  }

  // Contact form (appears after clicking + Add contact)
  contactNameInput() {
    return this.page.getByLabel('Name *')
  }

  contactPhoneInput() {
    return this.page.getByLabel('Phone *')
  }

  saveContactButton() {
    return this.page.getByRole('button', { name: 'Add contact' })
  }

  contactByName(name: string) {
    return this.page.getByText(name)
  }

  // Shift form (Sheet that opens after clicking + Add shift)
  shiftNameInput() {
    // Actual placeholder from ShiftBuilder.tsx
    return this.page.getByPlaceholder('e.g. Weeknight Coverage')
  }

  // Day buttons — ShiftBuilder renders days as plain <button> elements
  // Actual labels from DAY_LABELS in ShiftBuilder.tsx: Su, M, Tu, W, Th, F, Sa
  dayButton(day: 'Su' | 'M' | 'Tu' | 'W' | 'Th' | 'F' | 'Sa') {
    return this.page.getByRole('button', { name: day, exact: true })
  }

  escalationContactSelect() {
    // The first escalation step contact select
    return this.page.getByRole('combobox').first()
  }

  saveShiftButton() {
    // Scoped to the Sheet dialog to avoid matching the "+ Add shift" trigger button
    // that coexists in the DOM while the Sheet is open
    return this.page.getByRole('dialog').getByRole('button', { name: 'Add shift' })
  }

  shiftByName(name: string) {
    return this.page.getByText(name)
  }
}
```

- [ ] **Step 4: Create WizardPage.ts**

```typescript
import type { Page } from '@playwright/test'

export class WizardPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/answering-service/setup')
  }

  selfServeButton() {
    // PathSelector shows this button when no path is selected yet
    // Actual text from PathSelector.tsx: "Start Self-Serve Setup"
    return this.page.getByRole('button', { name: 'Start Self-Serve Setup' })
  }

  nextButton() {
    return this.page.getByRole('button', { name: /next/i })
  }

  stepTitle(name: string) {
    return this.page.getByRole('heading', { name })
  }
}
```

- [ ] **Step 5: Create OperatorClientsPage.ts**

```typescript
import type { Page } from '@playwright/test'

export class OperatorClientsPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/operator/clients')
  }

  heading() {
    return this.page.getByRole('heading', { name: 'Clients' })
  }

  clientByName(name: string) {
    return this.page.getByText(name)
  }

  async clickFirstClient() {
    await this.page.getByRole('link', { name: /view →/i }).first().click()
    await this.page.waitForURL(/\/operator\/clients\/.+/)
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/pages/
git commit -m "test: add BillingPage, SettingsPage, OnCallPage, WizardPage, OperatorClientsPage objects"
```

---

## Chunk 3: Auth Tests

### Task 7: Create auth.e2e.ts

**Files:**
- Create: `tests/e2e/auth.e2e.ts`

This file runs without stored auth state (project: `auth-tests`). It tests login, sign-out, failed login, and unauthenticated redirects.

- [ ] **Step 1: Create the file**

```typescript
import { test, expect } from '@playwright/test'
import { LoginPage } from './pages/LoginPage'
import { ClientPortalPage } from './pages/ClientPortalPage'
import { OperatorPortalPage } from './pages/OperatorPortalPage'

test.describe('Auth', () => {
  test('valid client login redirects to dashboard', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.signInAsClient()
    await expect(page).toHaveURL(/\/answering-service\/dashboard/)
  })

  test('valid operator login redirects to clients', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.signInAsOperator()
    await expect(page).toHaveURL(/\/operator\/clients/)
  })

  test('wrong password shows error and stays on login', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.signInRaw('demo@example.com', 'wrong-password')
    await expect(page).toHaveURL(/\/login/)
    // Supabase auth returns "Invalid login credentials" — assert some error is visible
    await expect(page.getByText(/invalid|incorrect|wrong|error/i).first()).toBeVisible()
  })

  test('client sign-out returns to login', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.signInAsClient()
    await expect(page).toHaveURL(/\/answering-service\/dashboard/)
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/)
  })

  test('operator sign-out returns to login', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.signInAsOperator()
    await expect(page).toHaveURL(/\/operator\/clients/)
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/)
  })

  test('unauthenticated access to client route redirects to login', async ({ page }) => {
    const portal = new ClientPortalPage(page)
    await portal.gotoDashboard()
    await expect(page).toHaveURL(/\/login/)
  })

  test('unauthenticated access to operator route redirects to login', async ({ page }) => {
    const operator = new OperatorPortalPage(page)
    await operator.gotoClients()
    await expect(page).toHaveURL(/\/login/)
  })
})
```

- [ ] **Step 2: Run against production**

```bash
PLAYWRIGHT_BASE_URL=https://answering.stintwell.com npx playwright test --project=auth-tests
```

Expected: 7 passing. If the error message text doesn't match, inspect the login page and adjust the `/invalid|incorrect|wrong|error/i` pattern.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/auth.e2e.ts
git commit -m "test: add auth.e2e.ts — login, sign-out, failed login, unauthenticated redirects"
```

---

## Chunk 4: Client Portal Tests

### Task 8: dashboard.e2e.ts

**Files:**
- Create: `tests/e2e/client/dashboard.e2e.ts`

- [ ] **Step 1: Create the file**

```typescript
import { test, expect } from '@playwright/test'

test.describe('Client dashboard', () => {
  test('page loads without console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/answering-service/dashboard')
    await page.waitForLoadState('networkidle')

    expect(errors).toEqual([])
  })

  test('dashboard heading is visible', async ({ page }) => {
    await page.goto('/answering-service/dashboard')
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  })
})
```

- [ ] **Step 2: Run against production**

```bash
PLAYWRIGHT_BASE_URL=https://answering.stintwell.com npx playwright test tests/e2e/client/dashboard.e2e.ts --project=client-tests
```

Expected: 2 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/client/dashboard.e2e.ts
git commit -m "test: add client dashboard e2e"
```

---

### Task 9: messages.e2e.ts

**Files:**
- Create: `tests/e2e/client/messages.e2e.ts`

- [ ] **Step 1: Create the file**

```typescript
import { test, expect } from '@playwright/test'

test.describe('Client messages', () => {
  test('message list renders with at least one entry', async ({ page }) => {
    await page.goto('/answering-service/messages')
    await page.waitForLoadState('networkidle')
    // Messages are in sections — assert at least one "View →" button is present
    await expect(page.getByRole('button', { name: 'View →' }).first()).toBeVisible()
  })

  test('clicking a message opens transcript view', async ({ page }) => {
    await page.goto('/answering-service/messages')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'View →' }).first().click()
    // Transcript view shows a "Back to list" button
    await expect(page.getByRole('button', { name: 'Back to list' })).toBeVisible()
  })
})
```

- [ ] **Step 2: Run against production**

```bash
PLAYWRIGHT_BASE_URL=https://answering.stintwell.com npx playwright test tests/e2e/client/messages.e2e.ts --project=client-tests
```

Expected: 2 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/client/messages.e2e.ts
git commit -m "test: add client messages e2e"
```

---

### Task 10: billing.e2e.ts

**Files:**
- Create: `tests/e2e/client/billing.e2e.ts`

- [ ] **Step 1: Create the file**

```typescript
import { test, expect } from '@playwright/test'
import { BillingPage } from '../pages/BillingPage'

test.describe('Client billing', () => {
  test('past invoices section is visible', async ({ page }) => {
    const billing = new BillingPage(page)
    await billing.goto()
    await page.waitForLoadState('networkidle')
    await expect(billing.pastInvoicesHeading()).toBeVisible()
  })

  test('running estimate is visible', async ({ page }) => {
    const billing = new BillingPage(page)
    await billing.goto()
    await page.waitForLoadState('networkidle')
    await expect(billing.runningEstimate()).toBeVisible()
  })
})
```

- [ ] **Step 2: Run against production**

```bash
PLAYWRIGHT_BASE_URL=https://answering.stintwell.com npx playwright test tests/e2e/client/billing.e2e.ts --project=client-tests
```

Expected: 2 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/client/billing.e2e.ts
git commit -m "test: add client billing e2e"
```

---

### Task 11: settings.e2e.ts

**Files:**
- Create: `tests/e2e/client/settings.e2e.ts`

The settings page manages API keys. The create/revoke cycle uses a unique label per run (`e2e-test-${Date.now()}`) so the new key is unambiguous when revoking.

- [ ] **Step 1: Create the file**

```typescript
import { test, expect } from '@playwright/test'
import { SettingsPage } from '../pages/SettingsPage'

test.describe('Client settings', () => {
  test('page loads with correct headings', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    const settings = new SettingsPage(page)
    await settings.goto()
    await page.waitForLoadState('networkidle')

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'API Keys' })).toBeVisible()
    expect(errors).toEqual([])
  })

  test('can create and revoke an API key', async ({ page }) => {
    const settings = new SettingsPage(page)
    await settings.goto()
    await page.waitForLoadState('networkidle')

    const label = `e2e-test-${Date.now()}`

    // Create
    await settings.keyLabelInput().fill(label)
    await settings.createKeyButton().click()

    // Dismiss the "I've saved it" confirmation so the key row appears
    await page.getByRole('button', { name: "I've saved it" }).click()

    // Key label should now be visible in the list
    await expect(settings.keyLabelText(label)).toBeVisible()

    // Revoke
    await settings.revokeButton(label).click()

    // Key label should no longer be visible
    await expect(settings.keyLabelText(label)).not.toBeVisible()
  })
})
```

- [ ] **Step 2: Run against production**

```bash
PLAYWRIGHT_BASE_URL=https://answering.stintwell.com npx playwright test tests/e2e/client/settings.e2e.ts --project=client-tests
```

Expected: 2 passing. If the "Revoke" button selector doesn't match, inspect `ApiKeyManager` and adjust `SettingsPage.revokeButton()`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/client/settings.e2e.ts
git commit -m "test: add client settings e2e — API key create/revoke"
```

---

### Task 12: on-call.e2e.ts

**Files:**
- Create: `tests/e2e/client/on-call.e2e.ts`

**Important:** the "add contact" test must run before "add shift" because `ShiftBuilder` requires at least one contact in the escalation step. Playwright runs tests in a single file sequentially by default, so ordering in the file is sufficient.

- [ ] **Step 1: Create the file**

```typescript
import { test, expect } from '@playwright/test'
import { OnCallPage } from '../pages/OnCallPage'

test.describe('Client on-call', () => {
  // Serial mode required: 'can add a shift' depends on a contact created by
  // 'can add a contact'. fullyParallel:true in the config would otherwise
  // run these concurrently and the shift test would fail.
  test.describe.configure({ mode: 'serial' })

  test('page heading and Shifts tab are visible', async ({ page }) => {
    const onCall = new OnCallPage(page)
    await onCall.goto()
    await expect(onCall.heading()).toBeVisible()
    await expect(onCall.shiftsTab()).toBeVisible()
  })

  // MUST run before 'can add a shift' — ShiftBuilder requires a contact in escalation
  test('can add a contact', async ({ page }) => {
    const onCall = new OnCallPage(page)
    await onCall.goto()

    await onCall.contactsTab().click()
    await onCall.addContactButton().click()

    const contactName = `E2E Contact ${Date.now()}`
    await onCall.contactNameInput().fill(contactName)
    await onCall.contactPhoneInput().fill('555-0199')
    await onCall.saveContactButton().click()

    // Contact name should now be visible in the list
    await expect(onCall.contactByName(contactName)).toBeVisible()
  })

  test('can add a shift', async ({ page }) => {
    const onCall = new OnCallPage(page)
    await onCall.goto()

    // Ensure we're on the Shifts tab
    await onCall.shiftsTab().click()
    await onCall.addShiftButton().click()

    const shiftName = `E2E Shift ${Date.now()}`
    await onCall.shiftNameInput().fill(shiftName)

    // Select Monday — days are plain buttons with abbreviated labels (M = Monday)
    await onCall.dayButton('M').click()

    // Select first available contact from escalation dropdown
    await onCall.escalationContactSelect().click()
    await page.getByRole('option').first().click()

    await onCall.saveShiftButton().click()

    // Shift name should now be visible in the schedule
    await expect(onCall.shiftByName(shiftName)).toBeVisible()
  })
})
```

- [ ] **Step 2: Run against production**

```bash
PLAYWRIGHT_BASE_URL=https://answering.stintwell.com npx playwright test tests/e2e/client/on-call.e2e.ts --project=client-tests
```

Expected: 3 passing. If the escalation contact select interaction fails, inspect `ShiftBuilder.tsx` — the select uses shadcn `<Select>` which may need `page.getByRole('option')` after clicking the trigger.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/client/on-call.e2e.ts
git commit -m "test: add client on-call e2e — contact and shift creation"
```

---

### Task 13: wizard.e2e.ts

**Files:**
- Create: `tests/e2e/client/wizard.e2e.ts`

The demo user may have a saved wizard session, so `PathSelector` may or may not appear. The test handles both cases.

- [ ] **Step 1: Create the file**

```typescript
import { test, expect } from '@playwright/test'
import { WizardPage } from '../pages/WizardPage'

test.describe('Client setup wizard', () => {
  test('can navigate through first three wizard steps', async ({ page }) => {
    const wizard = new WizardPage(page)
    await wizard.goto()
    await page.waitForLoadState('networkidle')

    // Handle PathSelector gate — it appears if user has no saved path
    const selfServeButton = wizard.selfServeButton()
    if (await selfServeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await selfServeButton.click()
    }

    // Step 1: Profile
    await expect(wizard.stepTitle('Profile')).toBeVisible()

    // Step 2: Greeting Script
    await wizard.nextButton().click()
    await expect(wizard.stepTitle('Greeting Script')).toBeVisible()

    // Step 3: Business Hours
    await wizard.nextButton().click()
    await expect(wizard.stepTitle('Business Hours')).toBeVisible()
  })
})
```

- [ ] **Step 2: Run against production**

```bash
PLAYWRIGHT_BASE_URL=https://answering.stintwell.com npx playwright test tests/e2e/client/wizard.e2e.ts --project=client-tests
```

Expected: 1 passing. Note: the Next button validates the current step before advancing, so if demo data is missing required fields for step 1 (e.g. industry), the test may get blocked. If so, fill the required fields before clicking Next.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/client/wizard.e2e.ts
git commit -m "test: add client wizard e2e — path selection gate + 3-step navigation"
```

---

### Task 14: client/mobile.e2e.ts

**Files:**
- Create: `tests/e2e/client/mobile.e2e.ts`

- [ ] **Step 1: Create the file**

```typescript
import { test, expect } from '@playwright/test'

test.describe('Client portal — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('dashboard renders at mobile size with BottomNav visible', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/answering-service/dashboard')
    await page.waitForLoadState('networkidle')

    // BottomNav is the mobile navigation — assert at least one of its links is visible
    await expect(page.getByRole('navigation').getByRole('link').first()).toBeVisible()

    expect(errors).toEqual([])
  })
})
```

- [ ] **Step 2: Run against production**

```bash
PLAYWRIGHT_BASE_URL=https://answering.stintwell.com npx playwright test tests/e2e/client/mobile.e2e.ts --project=client-tests
```

Expected: 1 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/client/mobile.e2e.ts
git commit -m "test: add client mobile e2e — 390x844 viewport smoke test"
```

---

## Chunk 5: Operator Portal Tests

### Task 15: operator/clients.e2e.ts

**Files:**
- Create: `tests/e2e/operator/clients.e2e.ts`

- [ ] **Step 1: Create the file**

```typescript
import { test, expect } from '@playwright/test'
import { OperatorClientsPage } from '../pages/OperatorClientsPage'

test.describe('Operator clients', () => {
  test('client list loads and shows Riverside Law Group', async ({ page }) => {
    const clients = new OperatorClientsPage(page)
    await clients.goto()
    await page.waitForLoadState('networkidle')

    await expect(clients.heading()).toBeVisible()
    await expect(clients.clientByName('Riverside Law Group')).toBeVisible()
  })

  test('clicking first client opens detail page with Who to Call card', async ({ page }) => {
    const clients = new OperatorClientsPage(page)
    await clients.goto()
    await page.waitForLoadState('networkidle')

    await clients.clickFirstClient()

    // "Who to Call" is an h3 inside a card on the operator client detail page
    await expect(page.getByText('Who to Call').first()).toBeVisible()
  })
})
```

- [ ] **Step 2: Run against production**

```bash
PLAYWRIGHT_BASE_URL=https://answering.stintwell.com npx playwright test tests/e2e/operator/clients.e2e.ts --project=operator-tests
```

Expected: 2 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/operator/clients.e2e.ts
git commit -m "test: add operator clients e2e — list + detail navigation"
```

---

### Task 16: operator/usage.e2e.ts

**Files:**
- Create: `tests/e2e/operator/usage.e2e.ts`

- [ ] **Step 1: Create the file**

```typescript
import { test, expect } from '@playwright/test'

test.describe('Operator usage', () => {
  test('page loads without console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/operator/usage')
    await page.waitForLoadState('networkidle')

    expect(errors).toEqual([])
  })
})
```

- [ ] **Step 2: Run against production**

```bash
PLAYWRIGHT_BASE_URL=https://answering.stintwell.com npx playwright test tests/e2e/operator/usage.e2e.ts --project=operator-tests
```

Expected: 1 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/operator/usage.e2e.ts
git commit -m "test: add operator usage e2e"
```

---

### Task 17: operator/billing-templates.e2e.ts

**Files:**
- Create: `tests/e2e/operator/billing-templates.e2e.ts`

- [ ] **Step 1: Create the file**

```typescript
import { test, expect } from '@playwright/test'

test.describe('Operator billing templates', () => {
  test('page loads without console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/operator/billing-templates')
    await page.waitForLoadState('networkidle')

    expect(errors).toEqual([])
  })
})
```

- [ ] **Step 2: Run against production**

```bash
PLAYWRIGHT_BASE_URL=https://answering.stintwell.com npx playwright test tests/e2e/operator/billing-templates.e2e.ts --project=operator-tests
```

Expected: 1 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/operator/billing-templates.e2e.ts
git commit -m "test: add operator billing-templates e2e"
```

---

### Task 18: operator/operator-api-keys.e2e.ts

**Files:**
- Create: `tests/e2e/operator/operator-api-keys.e2e.ts`

Tests the `ApiKeyManager` on `/operator/api-webhooks`. Creates and revokes a key to avoid accumulation.

- [ ] **Step 1: Create the file**

```typescript
import { test, expect } from '@playwright/test'
import { SettingsPage } from '../pages/SettingsPage'

test.describe('Operator API keys', () => {
  test('page loads', async ({ page }) => {
    await page.goto('/operator/api-webhooks')
    await page.waitForLoadState('networkidle')
    // API key manager is present on this page
    await expect(page.getByPlaceholder('Key label')).toBeVisible()
  })

  test('can create and revoke an operator API key', async ({ page }) => {
    // Reuse SettingsPage selectors — same ApiKeyManager component
    const settings = new SettingsPage(page)
    await page.goto('/operator/api-webhooks')
    await page.waitForLoadState('networkidle')

    const label = `e2e-op-${Date.now()}`

    // Create
    await settings.keyLabelInput().fill(label)
    await settings.createKeyButton().click()

    // Dismiss the confirmation
    await page.getByRole('button', { name: "I've saved it" }).click()

    // Key label visible in list
    await expect(settings.keyLabelText(label)).toBeVisible()

    // Revoke
    await settings.revokeButton(label).click()
    await expect(settings.keyLabelText(label)).not.toBeVisible()
  })
})
```

- [ ] **Step 2: Run against production**

```bash
PLAYWRIGHT_BASE_URL=https://answering.stintwell.com npx playwright test tests/e2e/operator/operator-api-keys.e2e.ts --project=operator-tests
```

Expected: 2 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/operator/operator-api-keys.e2e.ts
git commit -m "test: add operator API key create/revoke e2e"
```

---

### Task 19: operator/settings.e2e.ts

**Files:**
- Create: `tests/e2e/operator/settings.e2e.ts`

- [ ] **Step 1: Create the file**

```typescript
import { test, expect } from '@playwright/test'

test.describe('Operator settings', () => {
  test('page loads without console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/operator/settings')
    await page.waitForLoadState('networkidle')

    expect(errors).toEqual([])
  })
})
```

- [ ] **Step 2: Run against production**

```bash
PLAYWRIGHT_BASE_URL=https://answering.stintwell.com npx playwright test tests/e2e/operator/settings.e2e.ts --project=operator-tests
```

Expected: 1 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/operator/settings.e2e.ts
git commit -m "test: add operator settings e2e"
```

---

### Task 20: operator/mobile.e2e.ts

**Files:**
- Create: `tests/e2e/operator/mobile.e2e.ts`

- [ ] **Step 1: Create the file**

```typescript
import { test, expect } from '@playwright/test'

test.describe('Operator portal — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('clients page renders at mobile size without console errors', async ({ page }) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/operator/clients')
    await page.waitForLoadState('networkidle')

    // At least one element is visible (page did not blank out)
    await expect(page.getByRole('heading', { name: 'Clients' })).toBeVisible()

    expect(errors).toEqual([])
  })
})
```

- [ ] **Step 2: Run against production**

```bash
PLAYWRIGHT_BASE_URL=https://answering.stintwell.com npx playwright test tests/e2e/operator/mobile.e2e.ts --project=operator-tests
```

Expected: 1 passing.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/operator/mobile.e2e.ts
git commit -m "test: add operator mobile e2e — 390x844 viewport smoke test"
```

---

## Chunk 6: Final Verification

### Task 21: Run full suite against production

- [ ] **Step 1: Run the full suite**

```bash
PLAYWRIGHT_BASE_URL=https://answering.stintwell.com npx playwright test
```

Expected: all projects pass. Typical count: ~30 tests.

- [ ] **Step 2: View the HTML report**

```bash
npx playwright show-report
```

Review for any flaky tests or unexpected failures.

- [ ] **Step 3: Final commit**

```bash
git add .
git commit -m "test: complete E2E suite — production smoke + feature tests for client and operator portals"
```
