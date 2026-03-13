import { test, expect } from '@playwright/test'
import { OnCallPage } from '../pages/OnCallPage'

test.describe('Client on-call', () => {
  // Serial mode required: 'can add a shift' depends on a contact created by
  // 'can add a contact'. fullyParallel:true in the config would otherwise
  // run these concurrently and the shift test would fail.
  test.describe.configure({ mode: 'serial' })

  test('page heading and Shifts tab are visible', async ({ page }) => {
    const onCall = new OnCallPage(page)
    await onCall.goto()
    await expect(onCall.heading()).toBeVisible()
    await expect(onCall.shiftsTab()).toBeVisible()
  })

  // MUST run before 'can add a shift' — ShiftBuilder requires a contact in escalation
  test('can add a contact', async ({ page }) => {
    const onCall = new OnCallPage(page)
    await onCall.goto()

    await onCall.contactsTab().click()
    await onCall.addContactButton().click()

    const contactName = `E2E Contact ${Date.now()}`
    await onCall.contactNameInput().fill(contactName)
    await onCall.contactPhoneInput().fill('555-0199')
    await onCall.saveContactButton().click()

    // Contact name should now be visible in the list
    await expect(onCall.contactByName(contactName)).toBeVisible()
  })

  test('can add a shift', async ({ page }) => {
    const onCall = new OnCallPage(page)
    await onCall.goto()

    // Ensure we're on the Shifts tab
    await onCall.shiftsTab().click()
    await onCall.addShiftButton().click()

    const shiftName = `E2E Shift ${Date.now()}`
    await onCall.shiftNameInput().fill(shiftName)

    // Select Monday — days are plain buttons with abbreviated labels (M = Monday)
    await onCall.dayButton('M').click()

    // Select first available contact from escalation dropdown
    await onCall.escalationContactSelect().click()
    await page.getByRole('option').first().click()

    await onCall.saveShiftButton().click()

    // Shift name should now be visible in the schedule
    await expect(onCall.shiftByName(shiftName)).toBeVisible()
  })
})
