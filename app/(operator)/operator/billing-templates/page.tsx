import { Plus } from 'lucide-react'
import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import { listTemplates } from '@/lib/services/operator/billingTemplateService'
import { BillingTemplateManager } from '@/components/operator/BillingTemplateManager'
import { createBillingTemplateAction, deleteBillingTemplateAction } from './actions'

export default async function BillingTemplatesPage() {
  const context = await checkOperatorAccessOrThrow()
  const templates = await listTemplates(context.operatorOrgId)

  return (
    <div className="flex flex-col gap-6 p-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-foreground">Billing Templates</h1>
          <p className="text-sm text-muted-foreground">
            Define reusable pricing plans to assign to clients.
          </p>
        </div>
        {context.role === 'admin' ? (
          <div className="flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4">
            <Plus className="h-3.5 w-3.5 text-primary-foreground" />
            <span className="text-[13px] font-semibold text-primary-foreground">New Template</span>
          </div>
        ) : null}
      </div>

      {/* Templates */}
      <BillingTemplateManager
        templates={templates}
        isAdmin={context.role === 'admin'}
        createAction={createBillingTemplateAction}
        deleteAction={deleteBillingTemplateAction}
      />
    </div>
  )
}
