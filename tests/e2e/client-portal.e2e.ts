import * as path from 'path'
import * as dotenv from 'dotenv'
import { test, expect } from '@playwright/test'
import { LoginPage } from './pages/LoginPage'
import { ClientPortalPage } from './pages/ClientPortalPage'

dotenv.config({ path: path.resolve(process.cwd(), '.env.test') })

test.describe('Client portal', () => {
  test('login and land on dashboard', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.signInAsClient()

    await expect(page).toHaveURL(/\/answering-service\/dashboard/)
  })

  test('sidebar nav works', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.signInAsClient()

    const portal = new ClientPortalPage(page)

    await portal.gotoMessages()
    await expect(page).toHaveURL(/\/answering-service\/messages/)

    await portal.gotoBilling()
    await expect(page).toHaveURL(/\/answering-service\/billing/)

    await portal.gotoSettings()
    await expect(page).toHaveURL(/\/answering-service\/settings/)
  })

  test('unauthenticated redirect', async ({ page }) => {
    const portal = new ClientPortalPage(page)
    await portal.gotoDashboard()

    await expect(page).toHaveURL(/\/login/)
  })
})
