import * as path from 'path'
import * as dotenv from 'dotenv'
import { test as setup } from '@playwright/test'

dotenv.config({ path: path.resolve(process.cwd(), '.env.test') })

const CLIENT_AUTH_FILE = '.auth/client.json'
const OPERATOR_AUTH_FILE = '.auth/operator.json'

setup('save client auth state', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(
    process.env.TEST_CLIENT_EMAIL ?? 'demo@example.com',
  )
  await page.getByLabel('Password').fill(
    process.env.TEST_CLIENT_PASSWORD ?? 'demo-password-2026',
  )
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await page.context().storageState({ path: CLIENT_AUTH_FILE })
})

setup('save operator auth state', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(
    process.env.TEST_OPERATOR_EMAIL ?? 'operator@example.com',
  )
  await page.getByLabel('Password').fill(
    process.env.TEST_OPERATOR_PASSWORD ?? 'operator-password-2026',
  )
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await page.context().storageState({ path: OPERATOR_AUTH_FILE })
})
