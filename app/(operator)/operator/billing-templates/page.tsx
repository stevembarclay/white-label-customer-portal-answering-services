import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import { listTemplates } from '@/lib/services/operator/billingTemplateService'
import { BillingTemplateManager } from '@/components/operator/BillingTemplateManager'
import { createBillingTemplateAction, deleteBillingTemplateAction } from './actions'

export default async function BillingTemplatesPage() {
  const context = await checkOperatorAccessOrThrow()
  const templates = await listTemplates(context.operatorOrgId)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Rate Card Templates</h1>
        <p className="mt-1 text-sm text-slate-500">
          Define reusable billing rule sets. Apply a template to a client to quickly set up their billing.
        </p>
      </div>

      <BillingTemplateManager
        templates={templates}
        isAdmin={context.role === 'admin'}
        createAction={createBillingTemplateAction}
        deleteAction={deleteBillingTemplateAction}
      />
    </div>
  )
}
