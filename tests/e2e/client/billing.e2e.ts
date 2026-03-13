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
