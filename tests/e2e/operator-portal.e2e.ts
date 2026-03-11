import * as path from 'path'
import * as dotenv from 'dotenv'
import { test, expect } from '@playwright/test'
import { LoginPage } from './pages/LoginPage'
import { OperatorPortalPage } from './pages/OperatorPortalPage'

dotenv.config({ path: path.resolve(process.cwd(), '.env.test') })

test.describe('Operator portal', () => {
  test('login and reach operator clients', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.signInAsOperator()

    const operator = new OperatorPortalPage(page)
    await operator.gotoClients()

    await expect(page).toHaveURL(/\/operator\/clients/)
  })

  test('clients list shows Riverside Law Group', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.signInAsOperator()

    const operator = new OperatorPortalPage(page)
    await operator.gotoClients()

    await expect(page.getByText('Riverside Law Group')).toBeVisible()
  })

  test('operator nav works', async ({ page }) => {
    const login = new LoginPage(page)
    await login.goto()
    await login.signInAsOperator()

    const operator = new OperatorPortalPage(page)

    await operator.gotoUsage()
    await expect(page).toHaveURL(/\/operator\/usage/)

    await operator.gotoApiWebhooks()
    await expect(page).toHaveURL(/\/operator\/api-webhooks/)

    await operator.gotoSettings()
    await expect(page).toHaveURL(/\/operator\/settings/)
  })

  test('unauthenticated redirect', async ({ page }) => {
    const operator = new OperatorPortalPage(page)
    await operator.gotoClients()

    await expect(page).toHaveURL(/\/login/)
  })
})
