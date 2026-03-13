import type { Page } from '@playwright/test'

export class WizardPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/answering-service/setup')
  }

  selfServeButton() {
    // PathSelector shows this button when no path is selected yet
    // Actual text from PathSelector.tsx: "Start Self-Serve Setup"
    return this.page.getByRole('button', { name: 'Start Self-Serve Setup' })
  }

  nextButton() {
    return this.page.getByRole('button', { name: /next/i })
  }

  stepTitle(name: string) {
    return this.page.getByRole('heading', { name })
  }
}
