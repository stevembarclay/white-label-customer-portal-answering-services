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

    // Dismiss the "I've saved it" confirmation
    await page.getByRole('button', { name: "I've saved it" }).click()

    // The key list is server-rendered; reload so the new key appears in the list
    await settings.goto()
    await page.waitForLoadState('networkidle')

    // Key label should now be visible in the list
    await expect(settings.keyLabelText(label)).toBeVisible()

    // Revoke
    await settings.revokeButton(label).click()

    // Key label should no longer be visible
    await expect(settings.keyLabelText(label)).not.toBeVisible()
  })
})
