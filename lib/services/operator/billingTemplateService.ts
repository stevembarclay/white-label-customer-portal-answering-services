import { createClient } from '@/lib/supabase/server'
import type { BillingRuleType } from '@/types/answeringService'

/** A billing rule as stored inside a template (no businessId or database id yet). */
export interface TemplateRule {
  type: BillingRuleType
  name: string
  amount: number                  // cents
  callTypeFilter?: string[]
  includedMinutes?: number        // bucket only
  overageRate?: number            // bucket only, cents/min
  active: boolean
}

export interface BillingTemplate {
  id: string
  operatorOrgId: string
  name: string
  rules: TemplateRule[]
  createdAt: string
}

export interface BillingTemplateInput {
  name: string
  rules: TemplateRule[]
}

interface TemplateRow {
  id: string
  operator_org_id: string
  name: string
  rules: TemplateRule[]
  created_at: string
}

function mapRow(row: TemplateRow): BillingTemplate {
  return {
    id: row.id,
    operatorOrgId: row.operator_org_id,
    name: row.name,
    rules: row.rules ?? [],
    createdAt: row.created_at,
  }
}

export async function listTemplates(operatorOrgId: string): Promise<BillingTemplate[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('billing_rule_templates')
    .select('id, operator_org_id, name, rules, created_at')
    .eq('operator_org_id', operatorOrgId)
    .order('created_at', { ascending: false })

  if (error) throw new Error('Failed to load billing templates.')
  return ((data ?? []) as TemplateRow[]).map(mapRow)
}

export async function createTemplate(
  operatorOrgId: string,
  input: BillingTemplateInput
): Promise<BillingTemplate> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('billing_rule_templates')
    .insert({ operator_org_id: operatorOrgId, name: input.name, rules: input.rules })
    .select('id, operator_org_id, name, rules, created_at')
    .single()

  if (error || !data) throw new Error('Failed to create billing template.')
  return mapRow(data as TemplateRow)
}

export async function deleteTemplate(operatorOrgId: string, templateId: string): Promise<void> {
  const supabase = await createClient()
  const { error } = await supabase
    .from('billing_rule_templates')
    .delete()
    .eq('id', templateId)
    .eq('operator_org_id', operatorOrgId)   // scoped to operator — prevents cross-org delete

  if (error) throw new Error('Failed to delete billing template.')
}

/**
 * Copy a template's rules into billing_rules for a specific client business.
 * Existing rules for the business are NOT replaced — rules are appended.
 * Returns the count of rules inserted.
 */
export async function applyTemplateToClient(
  operatorOrgId: string,
  templateId: string,
  businessId: string
): Promise<number> {
  const supabase = await createClient()

  const { data: template, error: tplError } = await supabase
    .from('billing_rule_templates')
    .select('rules')
    .eq('id', templateId)
    .eq('operator_org_id', operatorOrgId)
    .maybeSingle()

  if (tplError || !template) throw new Error('Template not found.')

  const rules = ((template as { rules: TemplateRule[] }).rules ?? []).map((rule) => ({
    business_id: businessId,
    type: rule.type,
    name: rule.name,
    amount: rule.amount,
    call_type_filter: rule.callTypeFilter ?? null,
    included_minutes: rule.includedMinutes ?? null,
    overage_rate: rule.overageRate ?? null,
    active: rule.active,
  }))

  if (rules.length === 0) return 0

  const { error: insertError } = await supabase.from('billing_rules').insert(rules)
  if (insertError) throw new Error('Failed to apply template rules to client.')

  return rules.length
}
