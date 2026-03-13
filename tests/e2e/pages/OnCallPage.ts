import type { Page } from '@playwright/test'

export class OnCallPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/answering-service/on-call')
  }

  heading() {
    return this.page.getByRole('heading', { name: 'Who to Call' })
  }

  shiftsTab() {
    return this.page.getByRole('tab', { name: 'Shifts' })
  }

  contactsTab() {
    return this.page.getByRole('tab', { name: 'Contacts' })
  }

  addShiftButton() {
    return this.page.getByRole('button', { name: '+ Add shift' })
  }

  addContactButton() {
    return this.page.getByRole('button', { name: '+ Add contact' })
  }

  // Contact form (appears after clicking + Add contact)
  // The Label elements have no htmlFor/id association, so getByLabel won't work.
  // Use placeholder text instead (from ContactsTab.tsx).
  contactNameInput() {
    return this.page.getByPlaceholder('Dr. Sarah Smith')
  }

  contactPhoneInput() {
    return this.page.getByPlaceholder('555-0100')
  }

  saveContactButton() {
    return this.page.getByRole('button', { name: 'Add contact' })
  }

  contactByName(name: string) {
    return this.page.getByText(name)
  }

  // Shift form (Sheet that opens after clicking + Add shift)
  shiftNameInput() {
    // Actual placeholder from ShiftBuilder.tsx
    return this.page.getByPlaceholder('e.g. Weeknight Coverage')
  }

  // Day buttons — ShiftBuilder renders days as plain <button> elements
  // Actual labels from DAY_LABELS in ShiftBuilder.tsx: Su, M, Tu, W, Th, F, Sa
  dayButton(day: 'Su' | 'M' | 'Tu' | 'W' | 'Th' | 'F' | 'Sa') {
    return this.page.getByRole('button', { name: day, exact: true })
  }

  escalationContactSelect() {
    // Scoped to the Sheet dialog to avoid matching the timezone combobox on the main page.
    // The ShiftBuilder renders escalation contact selects inside a Sheet (dialog).
    return this.page.getByRole('dialog').getByRole('combobox').first()
  }

  saveShiftButton() {
    // Scoped to the Sheet dialog to avoid matching the "+ Add shift" trigger button
    // that coexists in the DOM while the Sheet is open
    return this.page.getByRole('dialog').getByRole('button', { name: 'Add shift' })
  }

  shiftByName(name: string) {
    return this.page.getByText(name)
  }
}
