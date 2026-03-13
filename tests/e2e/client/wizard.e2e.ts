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

    // Fill required profile fields. The demo user may not have these pre-populated.
    // Email is pre-filled from auth; businessName, contactName, and industry must be set.
    const businessNameInput = page.getByLabel('Business Name')
    if (!(await businessNameInput.inputValue())) {
      await businessNameInput.fill('E2E Test Business')
    }

    const contactNameInput = page.getByLabel('Contact Name')
    if (!(await contactNameInput.inputValue())) {
      await contactNameInput.fill('E2E Tester')
    }

    // Industry dropdown — select "Other" if not already set
    const industryTrigger = page.getByRole('combobox')
    const industryValue = await industryTrigger.textContent()
    if (!industryValue || industryValue.includes('Choose one')) {
      await industryTrigger.click()
      await page.getByRole('option', { name: 'Other' }).click()
    }

    // Step 2: Greeting Script
    await wizard.nextButton().click()
    await expect(wizard.stepTitle('Greeting Script')).toBeVisible()

    // Step 3: Business Hours
    await wizard.nextButton().click()
    await expect(wizard.stepTitle('Business Hours')).toBeVisible()
  })
})
