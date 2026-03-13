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
