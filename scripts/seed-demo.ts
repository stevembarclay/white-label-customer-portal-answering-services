import * as dotenv from 'dotenv'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

dotenv.config({ path: path.resolve(process.cwd(), '.env') })
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const DEMO_EMAIL = 'demo@example.com'
const DEMO_PASSWORD = 'demo-password-2026'
const BUSINESS_NAME = 'Riverside Law Group'
const BUSINESS_CREATED_AT = '2025-12-01T09:00:00Z'
const LAST_LOGIN_AT = '2026-03-09T23:59:59Z'

function makePrng(seed: number) {
  let value = seed

  return function next() {
    value |= 0
    value = (value + 0x6d2b79f5) | 0
    let result = Math.imul(value ^ (value >>> 15), 1 | value)
    result = (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}

const rand = makePrng(42)

function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min
}

function randItem<T>(items: T[]): T {
  return items[Math.floor(rand() * items.length)]
}

const CALLER_NAMES = [
  'Sarah Mitchell',
  'James Whitfield',
  'Maria Gonzalez',
  'Robert Chen',
  'Emily Torres',
  'David Nakamura',
  'Jennifer Park',
  'Thomas Wallace',
  'Amanda Rivera',
  'Christopher Lee',
  'Patricia Holmes',
  'Kevin Anderson',
  'Michelle Patel',
  'Daniel Kim',
  'Nancy Flores',
  'Steven Carter',
  'Karen Williams',
  'Brian Foster',
  'Linda Thompson',
  'Mark Harris',
]

const MESSAGE_TEMPLATES: Record<string, string[]> = {
  urgent: [
    'Caller needs attorney callback as soon as possible regarding a time-sensitive family law matter.',
    'Client says the situation cannot wait until later today and requested an urgent callback.',
  ],
  'new-client': [
    'Prospective client asked whether the firm handles custody and divorce matters and requested a consultation.',
    'New caller is seeking representation for a separation matter and asked for an attorney callback.',
  ],
  appointment: [
    'Client called to confirm or reschedule an existing appointment and asked for a return call.',
    'Caller requested an appointment update and left a callback number.',
  ],
  'general-info': [
    'Caller asked about office hours and what to bring to an initial consultation.',
    'General inquiry about firm services, parking, and payment options.',
  ],
  'after-hours': [
    'After-hours caller requested a callback during business hours and said the matter is urgent.',
    'Evening caller left a message asking for an attorney callback first thing in the morning.',
  ],
}

function makePhone(): string {
  return `555-${randInt(1000, 9999)}`
}

function pickCallType(): string {
  const roll = rand()
  if (roll < 0.12) return 'urgent'
  if (roll < 0.32) return 'new-client'
  if (roll < 0.50) return 'appointment'
  if (roll < 0.82) return 'general-info'
  return 'after-hours'
}

function pickPriority(callType: string): 'high' | 'medium' | 'low' {
  switch (callType) {
    case 'urgent':
    case 'after-hours':
      return rand() < 0.7 ? 'high' : 'medium'
    case 'new-client':
    case 'appointment':
      return rand() < 0.65 ? 'medium' : 'low'
    default:
      return 'low'
  }
}

function dailyCallCount(dayOfWeek: number): number {
  if (dayOfWeek === 0 || dayOfWeek === 6) return randInt(2, 4)
  if (dayOfWeek === 1 || dayOfWeek === 5) return randInt(8, 12)
  return randInt(5, 8)
}

function generateDuration(callType: string): number {
  if (callType === 'after-hours' && rand() < 0.3) return 0
  if (callType === 'urgent') return randInt(120, 420)
  if (callType === 'new-client') return randInt(180, 540)
  if (callType === 'appointment') return randInt(60, 180)
  return randInt(60, 240)
}

function generateTimestamp(date: Date, callType: string): string {
  const timestamp = new Date(date)
  if (callType === 'after-hours') {
    timestamp.setUTCHours(rand() < 0.5 ? randInt(0, 5) : randInt(22, 23), randInt(0, 59), randInt(0, 59), 0)
  } else {
    timestamp.setUTCHours(randInt(14, 23), randInt(0, 59), randInt(0, 59), 0)
  }
  return timestamp.toISOString()
}

function generateMessage(callType: string, callbackNumber: string | null): string {
  const base = randItem(MESSAGE_TEMPLATES[callType] ?? MESSAGE_TEMPLATES['general-info'])
  return callbackNumber ? `${base} Callback number provided.` : `${base} Caller did not leave a callback number.`
}

async function ensureDemoUser(): Promise<string> {
  const { data, error } = await supabase.auth.admin.listUsers()
  if (error) throw new Error(`Failed to list users: ${error.message}`)

  const existing = data.users.find((user) => user.email === DEMO_EMAIL)
  if (existing) {
    await supabase.auth.admin.updateUserById(existing.id, {
      password: DEMO_PASSWORD,
      email_confirm: true,
    })
    return existing.id
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    email_confirm: true,
  })

  if (createError || !created.user) {
    throw new Error(`Failed to create demo user: ${createError?.message ?? 'Unknown error'}`)
  }

  return created.user.id
}

async function resetBusiness(): Promise<void> {
  const { data, error } = await supabase.from('businesses').select('id').eq('name', BUSINESS_NAME).maybeSingle()
  if (error) throw new Error(`Failed to look up existing business: ${error.message}`)

  if (data) {
    const { error: deleteError } = await supabase.from('businesses').delete().eq('id', data.id)
    if (deleteError) {
      throw new Error(`Failed to delete existing demo business: ${deleteError.message}`)
    }
  }
}

async function createBusiness(userId: string): Promise<string> {
  const { data: business, error } = await supabase
    .from('businesses')
    .insert({
      name: BUSINESS_NAME,
      enabled_modules: ['answering_service'],
      created_at: BUSINESS_CREATED_AT,
    })
    .select('id')
    .single()

  if (error || !business) {
    throw new Error(`Failed to create business: ${error?.message ?? 'Unknown error'}`)
  }

  const businessId = business.id as string

  const { error: membershipError } = await supabase.from('users_businesses').insert({
    user_id: userId,
    business_id: businessId,
    role: 'owner',
    last_login_at: LAST_LOGIN_AT,
  })

  if (membershipError) {
    throw new Error(`Failed to link user to business: ${membershipError.message}`)
  }

  return businessId
}

async function insertWizardSession(businessId: string, userId: string): Promise<void> {
  const { error } = await supabase.from('answering_service_wizard_sessions').insert({
    business_id: businessId,
    user_id: userId,
    current_step: 4,
    wizard_data: {},
    path_selected: 'self_serve',
    status: 'completed',
    started_at: BUSINESS_CREATED_AT,
    completed_at: BUSINESS_CREATED_AT,
  })

  if (error) throw new Error(`Failed to insert wizard session: ${error.message}`)
}

async function insertBillingRules(businessId: string): Promise<void> {
  const { error } = await supabase.from('billing_rules').insert([
    {
      business_id: businessId,
      type: 'per_call',
      name: 'Per Call Fee',
      amount: 350,
      call_type_filter: null,
      active: true,
    },
    {
      business_id: businessId,
      type: 'per_call',
      name: 'After-hours premium',
      amount: 200,
      call_type_filter: ['after-hours'],
      active: true,
    },
    {
      business_id: businessId,
      type: 'flat_monthly',
      name: 'Monthly Maintenance Fee',
      amount: 5900,
      call_type_filter: null,
      active: true,
    },
  ])

  if (error) throw new Error(`Failed to insert billing rules: ${error.message}`)
}

async function insertHistoricalCalls(businessId: string): Promise<void> {
  const rows: Array<Record<string, string | number | boolean | null>> = []
  const current = new Date('2025-12-01T00:00:00Z')
  const end = new Date('2026-02-28T23:59:59Z')

  while (current <= end) {
    const count = dailyCallCount(current.getUTCDay())
    for (let index = 0; index < count; index += 1) {
      const callType = pickCallType()
      const callbackNumber = rand() > 0.15 ? makePhone() : null
      const durationSeconds = generateDuration(callType)
      rows.push({
        business_id: businessId,
        timestamp: generateTimestamp(current, callType),
        caller_name: randItem(CALLER_NAMES),
        caller_number: makePhone(),
        callback_number: callbackNumber,
        call_type: callType,
        direction: 'inbound',
        duration_seconds: durationSeconds,
        telephony_status: durationSeconds === 0 ? 'missed' : 'completed',
        message: generateMessage(callType, callbackNumber),
        has_recording: rand() < 0.1,
        priority: pickPriority(callType),
        portal_status: 'read',
      })
    }
    current.setUTCDate(current.getUTCDate() + 1)
  }

  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await supabase.from('call_logs').insert(rows.slice(index, index + 100))
    if (error) throw new Error(`Failed to insert historical calls: ${error.message}`)
  }
}

async function insertQaCall(businessId: string, userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('call_logs')
    .insert({
      business_id: businessId,
      timestamp: '2026-02-14T14:32:00Z',
      caller_name: 'James Patterson',
      caller_number: '555-7823',
      callback_number: null,
      call_type: 'urgent',
      direction: 'inbound',
      duration_seconds: 187,
      telephony_status: 'completed',
      message: 'Caller did not leave a callback number. Said matter was urgent but would not provide details.',
      has_recording: false,
      priority: 'high',
      portal_status: 'flagged_qa',
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(`Failed to insert QA call: ${error?.message ?? 'Unknown error'}`)

  const { error: actionError } = await supabase.from('message_actions').insert({
    call_log_id: data.id,
    business_id: businessId,
    type: 'flagged_qa',
    by_user_id: userId,
    at: '2026-02-14T15:00:00Z',
  })

  if (actionError) throw new Error(`Failed to insert QA action: ${actionError.message}`)
}

async function insertBillingPeriods(businessId: string): Promise<void> {
  const { error } = await supabase.from('billing_periods').insert([
    {
      business_id: businessId,
      period_start: '2025-12-01T00:00:00Z',
      period_end: '2025-12-31T23:59:59Z',
      status: 'paid',
      total_cents: 46100,
      call_count: 114,
      line_items: [
        { ruleId: 'dec-r1', ruleName: 'Per Call Fee', unitDescription: '114 calls × $3.50', subtotalCents: 39900 },
        { ruleId: 'dec-r2', ruleName: 'After-hours premium', unitDescription: '8 after-hours calls × $2.00', subtotalCents: 1600 },
        { ruleId: 'dec-r3', ruleName: 'Monthly Maintenance Fee', unitDescription: 'Monthly fee', subtotalCents: 5900 },
      ],
      paid_at: '2026-01-05T10:00:00Z',
    },
    {
      business_id: businessId,
      period_start: '2026-01-01T00:00:00Z',
      period_end: '2026-01-31T23:59:59Z',
      status: 'paid',
      total_cents: 38750,
      call_count: 94,
      line_items: [
        { ruleId: 'jan-r1', ruleName: 'Per Call Fee', unitDescription: '94 calls × $3.50', subtotalCents: 32900 },
        { ruleId: 'jan-r2', ruleName: 'After-hours premium', unitDescription: '7 after-hours calls × $2.00', subtotalCents: 1400 },
        { ruleId: 'jan-r3', ruleName: 'Monthly Maintenance Fee', unitDescription: 'Monthly fee', subtotalCents: 5900 },
      ],
      paid_at: '2026-02-04T10:00:00Z',
    },
    {
      business_id: businessId,
      period_start: '2026-02-01T00:00:00Z',
      period_end: '2026-02-28T23:59:59Z',
      status: 'paid',
      total_cents: 41200,
      call_count: 100,
      line_items: [
        { ruleId: 'feb-r1', ruleName: 'Per Call Fee', unitDescription: '100 calls × $3.50', subtotalCents: 35000 },
        { ruleId: 'feb-r2', ruleName: 'After-hours premium', unitDescription: '9 after-hours calls × $2.00', subtotalCents: 1800 },
        { ruleId: 'feb-r3', ruleName: 'Monthly Maintenance Fee', unitDescription: 'Monthly fee', subtotalCents: 5900 },
      ],
      paid_at: '2026-03-04T10:00:00Z',
    },
    {
      business_id: businessId,
      period_start: '2026-03-01T00:00:00Z',
      period_end: '2026-03-31T23:59:59Z',
      status: 'open',
    },
  ])

  if (error) throw new Error(`Failed to insert billing periods: ${error.message}`)
}

async function insertMarchCalls(businessId: string): Promise<void> {
  const marchRows: Array<Record<string, string | number | boolean | null>> = []
  const current = new Date('2026-03-01T00:00:00Z')
  const end = new Date('2026-03-09T23:59:59Z')

  while (current <= end) {
    const count = dailyCallCount(current.getUTCDay())
    for (let index = 0; index < count; index += 1) {
      const callType = pickCallType()
      const callbackNumber = rand() > 0.2 ? makePhone() : null
      const durationSeconds = generateDuration(callType)
      marchRows.push({
        business_id: businessId,
        timestamp: generateTimestamp(current, callType),
        caller_name: randItem(CALLER_NAMES),
        caller_number: makePhone(),
        callback_number: callbackNumber,
        call_type: callType,
        direction: 'inbound',
        duration_seconds: durationSeconds,
        telephony_status: durationSeconds === 0 ? 'missed' : 'completed',
        message: generateMessage(callType, callbackNumber),
        has_recording: false,
        priority: pickPriority(callType),
        portal_status: 'read',
      })
    }
    current.setUTCDate(current.getUTCDate() + 1)
  }

  const storyCalls = [
    {
      business_id: businessId,
      timestamp: '2026-03-10T07:47:00Z',
      caller_name: 'Marcus Webb',
      caller_number: '555-0192',
      callback_number: '555-0192',
      call_type: 'urgent',
      direction: 'inbound',
      duration_seconds: 167,
      telephony_status: 'completed',
      message: "Calling re: tomorrow's hearing. Needs attorney callback before 8am. Available at 555-0192.",
      has_recording: false,
      priority: 'high',
      portal_status: 'new',
    },
    {
      business_id: businessId,
      timestamp: '2026-03-10T04:22:00Z',
      caller_name: 'Sandra Cho',
      caller_number: '555-0847',
      callback_number: '555-0847',
      call_type: 'new-client',
      direction: 'inbound',
      duration_seconds: 223,
      telephony_status: 'completed',
      message: 'Interested in family law. Going through divorce. Asks if firm handles custody. Available 9am–12pm at 555-0847.',
      has_recording: false,
      priority: 'medium',
      portal_status: 'new',
    },
    {
      business_id: businessId,
      timestamp: '2026-03-10T02:05:00Z',
      caller_name: 'David Park',
      caller_number: '555-2215',
      callback_number: null,
      call_type: 'general-info',
      direction: 'inbound',
      duration_seconds: 95,
      telephony_status: 'completed',
      message: 'Asked about office hours and parking validation.',
      has_recording: false,
      priority: 'low',
      portal_status: 'new',
    },
  ]

  const { error } = await supabase.from('call_logs').insert([...marchRows, ...storyCalls])
  if (error) throw new Error(`Failed to insert March calls: ${error.message}`)
}

async function main() {
  console.log('Seeding Riverside Law Group demo...')
  const userId = await ensureDemoUser()
  await resetBusiness()
  const businessId = await createBusiness(userId)
  await insertWizardSession(businessId, userId)
  await insertBillingRules(businessId)
  await insertHistoricalCalls(businessId)
  await insertQaCall(businessId, userId)
  await insertBillingPeriods(businessId)
  await insertMarchCalls(businessId)

  console.log('Seed complete.')
  console.log(`Email: ${DEMO_EMAIL}`)
  console.log(`Password: ${DEMO_PASSWORD}`)
  console.log(`Business: ${BUSINESS_NAME}`)
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
