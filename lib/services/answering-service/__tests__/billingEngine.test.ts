import { calculateBilling } from '@/lib/services/answering-service/billingEngine'
import type { BillingRule, CallLog } from '@/types/answeringService'

const BUSINESS_ID = 'business-1'
const PERIOD = {
  start: new Date('2026-03-01T00:00:00Z'),
  end: new Date('2026-03-31T23:59:59Z'),
}
const BUSINESS_CREATED_AT = new Date('2025-11-01T00:00:00Z')

function makeCall(overrides: Partial<CallLog> = {}): CallLog {
  return {
    id: 'call-1',
    businessId: BUSINESS_ID,
    timestamp: '2026-03-10T10:00:00Z',
    callType: 'general-info',
    direction: 'inbound',
    durationSeconds: 180,
    telephonyStatus: 'completed',
    message: 'Test message',
    priority: 'low',
    portalStatus: 'new',
    isNew: false,
    actions: [],
    ...overrides,
  }
}

function makeRule(overrides: Partial<BillingRule> = {}): BillingRule {
  return {
    id: 'rule-1',
    businessId: BUSINESS_ID,
    type: 'per_call',
    name: 'Per Call Fee',
    amount: 350,
    active: true,
    callTypeFilter: undefined,
    includedMinutes: undefined,
    overageRate: undefined,
    ...overrides,
  }
}

describe('billingEngine', () => {
  it('47 calls × $3.50 = $164.50', () => {
    const rule = makeRule({ amount: 350 })
    const calls = Array.from({ length: 47 }, (_, index) => makeCall({ id: `call-${index}` }))
    const [item] = calculateBilling([rule], calls, PERIOD, BUSINESS_CREATED_AT)

    expect(item.subtotalCents).toBe(16450)
  })

  it('12 after-hours calls × $2.00 = $24.00', () => {
    const rule = makeRule({
      amount: 200,
      callTypeFilter: ['after-hours'],
      name: 'After-hours premium',
    })

    const calls = [
      ...Array.from({ length: 12 }, (_, index) =>
        makeCall({ id: `after-hours-${index}`, callType: 'after-hours' })
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        makeCall({ id: `general-${index}`, callType: 'general-info' })
      ),
    ]

    const [item] = calculateBilling([rule], calls, PERIOD, BUSINESS_CREATED_AT)
    expect(item.subtotalCents).toBe(2400)
  })

  it('flat monthly is $59.00 regardless of call count', () => {
    const [item] = calculateBilling(
      [makeRule({ type: 'flat_monthly', amount: 5900, name: 'Monthly Maintenance Fee' })],
      [],
      PERIOD,
      BUSINESS_CREATED_AT
    )

    expect(item.subtotalCents).toBe(5900)
  })

  it('bucket charges overage only', () => {
    const calls = Array.from({ length: 41 }, (_, index) =>
      makeCall({ id: `bucket-${index}`, durationSeconds: 180 })
    )

    const [item] = calculateBilling(
      [
        makeRule({
          type: 'bucket',
          amount: 0,
          name: 'Minute Bucket',
          includedMinutes: 100,
          overageRate: 5,
        }),
      ],
      calls,
      PERIOD,
      BUSINESS_CREATED_AT
    )

    expect(item.subtotalCents).toBe(115)
  })

  it('setup fee appears only in the first period', () => {
    const rule = makeRule({ type: 'setup_fee', amount: 9900, name: 'Setup Fee' })
    const firstPeriodItems = calculateBilling([rule], [], PERIOD, new Date('2026-03-05T00:00:00Z'))
    const laterPeriodItems = calculateBilling([rule], [], PERIOD, BUSINESS_CREATED_AT)

    expect(firstPeriodItems).toHaveLength(1)
    expect(firstPeriodItems[0].subtotalCents).toBe(9900)
    expect(laterPeriodItems).toHaveLength(0)
  })

  it('zero-duration call counts for per_call and is excluded from per_minute', () => {
    const calls = [
      makeCall({ id: 'zero-duration', durationSeconds: 0 }),
      makeCall({ id: 'normal-duration', durationSeconds: 120 }),
    ]

    const [perCallItem, perMinuteItem] = calculateBilling(
      [
        makeRule({ id: 'per-call', type: 'per_call', amount: 350 }),
        makeRule({ id: 'per-minute', type: 'per_minute', amount: 10 }),
      ],
      calls,
      PERIOD,
      BUSINESS_CREATED_AT
    )

    expect(perCallItem.subtotalCents).toBe(700)
    expect(perMinuteItem.subtotalCents).toBe(20)
  })
})
