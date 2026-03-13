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
}
