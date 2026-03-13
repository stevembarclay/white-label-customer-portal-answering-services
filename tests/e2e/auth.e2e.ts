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
