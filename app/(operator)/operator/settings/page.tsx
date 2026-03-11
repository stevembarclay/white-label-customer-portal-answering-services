import { checkOperatorAccessOrThrow } from '@/lib/auth/server'
import { createClient } from '@/lib/supabase/server'

export default async function SettingsPage() {
  const context = await checkOperatorAccessOrThrow()
  const supabase = await createClient()

  const [{ data: org }, { data: templates }] = await Promise.all([
    supabase
      .from('operator_orgs')
      .select('id, name, slug, branding, settings')
      .eq('id', context.operatorOrgId)
      .single(),
    supabase
      .from('billing_rule_templates')
      .select('id, name, description, rules, created_at')
      .eq('operator_org_id', context.operatorOrgId)
      .order('name'),
  ])

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-slate-500">Operator organization metadata and reusable billing rule templates.</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Organization</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-[120px_1fr]">
          <dt className="text-slate-500">Name</dt>
          <dd>{(org as { name?: string } | null)?.name ?? '—'}</dd>
          <dt className="text-slate-500">Slug</dt>
          <dd className="font-mono">{(org as { slug?: string } | null)?.slug ?? '—'}</dd>
        </dl>
      </section>

      <section className="space-y-4">
        <h2 className="text-base font-semibold">Billing Rule Templates</h2>
        {(templates ?? []).length === 0 ? (
          <p className="text-sm text-slate-400">No templates defined. Contact support to create templates.</p>
        ) : (
          <ul className="space-y-2">
            {(templates ?? []).map((template) => {
              const ruleCount = Array.isArray(template.rules) ? template.rules.length : 0

              return (
                <li key={template.id} className="rounded-md border border-slate-200 px-3 py-2">
                  <p className="font-medium">{template.name}</p>
                  {template.description && <p className="text-sm text-slate-500">{template.description}</p>}
                  <p className="mt-1 text-xs text-slate-400">
                    {ruleCount} rule{ruleCount === 1 ? '' : 's'}
                  </p>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="rounded-md border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500">
        White-label branding configuration is managed via service role. Contact the platform administrator to update logo, colors, or custom domain settings.
      </section>
    </div>
  )
}
