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
