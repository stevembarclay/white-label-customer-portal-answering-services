import type {
  BillingEstimate,
  BillingInvoice,
  BillingLineItem,
  BillingRule,
  CallLog,
} from '@/types/answeringService'

function filterByCallType(calls: CallLog[], filter: string[] | undefined): CallLog[] {
  if (!filter || filter.length === 0) {
    return calls
  }

  return calls.filter((call) => filter.includes(call.callType))
}

function durationCalls(calls: CallLog[]): CallLog[] {
  return calls.filter((call) => call.durationSeconds > 0)
}

function totalRoundedMinutes(calls: CallLog[]): number {
  return calls.reduce((sum, call) => sum + Math.ceil(call.durationSeconds / 60), 0)
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function applyPerCall(rule: BillingRule, calls: CallLog[]): BillingLineItem {
  const filtered = filterByCallType(calls, rule.callTypeFilter)
  const count = filtered.length

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    unitDescription: `${count} call${count === 1 ? '' : 's'} × ${formatCurrency(rule.amount)}`,
    subtotalCents: count * rule.amount,
  }
}

function applyPerMinute(rule: BillingRule, calls: CallLog[]): BillingLineItem {
  const filtered = durationCalls(filterByCallType(calls, rule.callTypeFilter))
  const minutes = totalRoundedMinutes(filtered)

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    unitDescription: `${minutes} min × ${formatCurrency(rule.amount)}/min`,
    subtotalCents: minutes * rule.amount,
  }
}

function applyFlatMonthly(rule: BillingRule): BillingLineItem {
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    unitDescription: 'Monthly fee',
    subtotalCents: rule.amount,
  }
}

function applySetupFee(
  rule: BillingRule,
  businessCreatedAt: Date,
  periodStart: Date
): BillingLineItem | null {
  const isFirstPeriod =
    businessCreatedAt.getUTCFullYear() === periodStart.getUTCFullYear() &&
    businessCreatedAt.getUTCMonth() === periodStart.getUTCMonth()

  if (!isFirstPeriod) {
    return null
  }

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    unitDescription: 'One-time setup fee',
    subtotalCents: rule.amount,
  }
}

function applyBucket(rule: BillingRule, calls: CallLog[]): BillingLineItem {
  const filtered = durationCalls(filterByCallType(calls, rule.callTypeFilter))
  const minutes = totalRoundedMinutes(filtered)
  const includedMinutes = rule.includedMinutes ?? 0
  const overageRate = rule.overageRate ?? 0
  const overageMinutes = Math.max(0, minutes - includedMinutes)
  const subtotalCents = overageMinutes * overageRate

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    unitDescription:
      overageMinutes === 0
        ? `${minutes} of ${includedMinutes} min included (no overage)`
        : `${includedMinutes} min included + ${overageMinutes} overage × ${formatCurrency(overageRate)}/min`,
    subtotalCents,
  }
}

export function calculateBilling(
  rules: BillingRule[],
  calls: CallLog[],
  period: { start: Date; end: Date },
  businessCreatedAt: Date
): BillingLineItem[] {
  const lineItems: BillingLineItem[] = []

  for (const rule of rules.filter((candidate) => candidate.active)) {
    switch (rule.type) {
      case 'per_call':
        lineItems.push(applyPerCall(rule, calls))
        break
      case 'per_minute':
        lineItems.push(applyPerMinute(rule, calls))
        break
      case 'flat_monthly':
        lineItems.push(applyFlatMonthly(rule))
        break
      case 'setup_fee': {
        const setupFee = applySetupFee(rule, businessCreatedAt, period.start)
        if (setupFee) {
          lineItems.push(setupFee)
        }
        break
      }
      case 'bucket':
        lineItems.push(applyBucket(rule, calls))
        break
    }
  }

  return lineItems
}

export function calculateEstimate(
  businessId: string,
  rules: BillingRule[],
  calls: CallLog[],
  period: { start: Date; end: Date },
  businessCreatedAt: Date
): BillingEstimate {
  const lineItems = calculateBilling(rules, calls, period, businessCreatedAt)

  return {
    businessId,
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    asOf: new Date().toISOString(),
    totalCents: lineItems.reduce((sum, item) => sum + item.subtotalCents, 0),
    callCount: calls.length,
    lineItems,
  }
}

export function calculateInvoice(
  businessId: string,
  rules: BillingRule[],
  calls: CallLog[],
  period: { start: Date; end: Date },
  businessCreatedAt: Date
): Pick<BillingInvoice, 'businessId' | 'periodStart' | 'periodEnd' | 'totalCents' | 'callCount' | 'lineItems'> {
  const lineItems = calculateBilling(rules, calls, period, businessCreatedAt)

  return {
    businessId,
    periodStart: period.start.toISOString(),
    periodEnd: period.end.toISOString(),
    totalCents: lineItems.reduce((sum, item) => sum + item.subtotalCents, 0),
    callCount: calls.length,
    lineItems,
  }
}
