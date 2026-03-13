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
