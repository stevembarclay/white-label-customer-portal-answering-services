import { test, expect } from '@playwright/test'
import { OnCallPage } from '../pages/OnCallPage'

test.describe('Client on-call', () => {
  test('page heading and Shifts tab are visible', async ({ page }) => {
    const onCall = new OnCallPage(page)
    await onCall.goto()
    await expect(onCall.heading()).toBeVisible()
    await expect(onCall.shiftsTab()).toBeVisible()
  })
})
