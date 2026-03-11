'use server'

import { revalidatePath } from 'next/cache'
import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import {
  createTemplate,
  deleteTemplate,
  type BillingTemplateInput,
} from '@/lib/services/operator/billingTemplateService'

export async function createBillingTemplateAction(input: BillingTemplateInput): Promise<void> {
  const context = await checkOperatorAccessOrThrow()
  if (context.role !== 'admin') throw new Error('Admin role required.')
  await createTemplate(context.operatorOrgId, input)
  revalidatePath('/operator/billing-templates')
}

export async function deleteBillingTemplateAction(templateId: string): Promise<void> {
  const context = await checkOperatorAccessOrThrow()
  if (context.role !== 'admin') throw new Error('Admin role required.')
  await deleteTemplate(context.operatorOrgId, templateId)
  revalidatePath('/operator/billing-templates')
}
