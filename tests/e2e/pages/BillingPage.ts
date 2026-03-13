import type { Page } from '@playwright/test'

export class BillingPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/answering-service/billing')
  }

  pastInvoicesHeading() {
    return this.page.getByRole('heading', { name: 'Past invoices' })
  }

  runningEstimate() {
    // The running estimate card contains the text "Running estimate"
    return this.page.getByText('Running estimate').first()
  }
}
