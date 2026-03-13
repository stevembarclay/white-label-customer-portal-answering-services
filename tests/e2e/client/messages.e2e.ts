import { test, expect } from '@playwright/test'

test.describe('Client messages', () => {
  test('message list renders with at least one entry', async ({ page }) => {
    await page.goto('/answering-service/messages')
    await page.waitForLoadState('networkidle')

    // If all messages are in the "Earlier" collapsed section, expand it first
    const expandButton = page.getByRole('button', { name: /previous message/ })
    if (await expandButton.isVisible()) {
      await expandButton.click()
    }

    // Messages are in sections — assert at least one "View →" button is present
    await expect(page.getByRole('button', { name: 'View →' }).first()).toBeVisible()
  })

  test('clicking a message opens transcript view', async ({ page }) => {
    await page.goto('/answering-service/messages')
    await page.waitForLoadState('networkidle')

    // If all messages are in the "Earlier" collapsed section, expand it first
    const expandButton = page.getByRole('button', { name: /previous message/ })
    if (await expandButton.isVisible()) {
      await expandButton.click()
    }

    await page.getByRole('button', { name: 'View →' }).first().click()
    // Transcript view shows a "Back to list" button
    await expect(page.getByRole('button', { name: 'Back to list' })).toBeVisible()
  })
})
