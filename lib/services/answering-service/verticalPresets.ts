import type {
  Greeting,
  BusinessHours,
  CallTypes,
  MessageDelivery,
  Escalation,
  AnsweringServiceSetup,
} from '@/schemas/answeringServiceSchema'

// ─── Types ────────────────────────────────────────────────────────────────────

export type Template = { id: string; text: string }

export type VerticalPresets = {
  greeting: Greeting
  businessHours: BusinessHours
  callTypes: CallTypes
  messageDelivery: MessageDelivery
  escalation: Escalation
}

type Industry = Exclude<AnsweringServiceSetup['profile']['industry'], ''>

// ─── Greeting Templates ───────────────────────────────────────────────────────

export const BASE_TEMPLATES: Template[] = [
  { id: 'template-1', text: 'Thank you for calling {business_name}. How may I help you?' },
  { id: 'template-2', text: 'Good [morning/afternoon], {business_name}. How may I direct your call?' },
  { id: 'template-3', text: '{business_name}, this is [agent name]. How can I help you today?' },
  { id: 'template-4', text: "You've reached {business_name}. May I have your name and the reason for your call?" },
  { id: 'custom', text: 'Custom' },
]

const LEGAL_GREETING_TEMPLATES: Template[] = [
  { id: 'legal-1', text: 'Law offices of {business_name}. How may I direct your call?' },
  { id: 'legal-2', text: '{business_name}. Are you a new or existing client?' },
]

const MEDICAL_GREETING_TEMPLATES: Template[] = [
  { id: 'medical-1', text: '{business_name}. Is this regarding an appointment or a medical concern?' },
]

const REAL_ESTATE_GREETING_TEMPLATES: Template[] = [
  {
    id: 'real_estate-1',
    text: '{business_name}. Are you calling about a property for sale or an existing transaction?',
  },
]

const INDUSTRY_SPECIFIC_TEMPLATES: Partial<Record<Industry, Template[]>> = {
  legal: LEGAL_GREETING_TEMPLATES,
  medical: MEDICAL_GREETING_TEMPLATES,
  real_estate: REAL_ESTATE_GREETING_TEMPLATES,
}

/**
 * Returns the full ordered template list for the greeting dropdown.
 * Order: base templates (minus Custom) → industry-specific → Custom last.
 * Template IDs here are canonical — they must match what getVerticalPresets writes
 * into greeting.template.
 */
export function getIndustryGreetingTemplates(industry: Industry): Template[] {
  const specific = INDUSTRY_SPECIFIC_TEMPLATES[industry] ?? []
  const base = BASE_TEMPLATES.slice(0, -1) // all except 'custom'
  return [...base, ...specific, { id: 'custom', text: 'Custom' }]
}

// ─── Shared Helpers ───────────────────────────────────────────────────────────

const BASE_INFO_FIELDS = [
  { field: 'caller_name', required: true },
  { field: 'phone_number', required: true },
]

/** M–F 9am–5pm, Sat–Sun closed. Matches BusinessHoursStep day/time format. */
function standardWeekdayHours(): NonNullable<BusinessHours['customHours']> {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  return days.map(day => ({
    day,
    open: '9:00 AM',
    close: '5:00 PM',
    closed: day === 'saturday' || day === 'sunday',
  }))
}

/** M–F 8am–5pm, Sat–Sun closed. Used for medical practices. */
function medicalWeekdayHours(): NonNullable<BusinessHours['customHours']> {
  const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
  return days.map(day => ({
    day,
    open: '8:00 AM',
    close: '5:00 PM',
    closed: day === 'saturday' || day === 'sunday',
  }))
}

// ─── Preset Factories ─────────────────────────────────────────────────────────

function getLegalPresets(): VerticalPresets {
  return {
    greeting: { template: 'legal-1', presentAs: 'employee', language: 'english' },
    businessHours: { type: 'custom', timezone: 'America/New_York', customHours: standardWeekdayHours() },
    callTypes: [
      {
        id: crypto.randomUUID(),
        name: 'New Client Inquiry',
        timeConditions: {
          businessHours: {
            action: 'screen_and_patch',
            infoToCollect: [
              ...BASE_INFO_FIELDS,
              { field: 'case_nature', required: true, customLabel: 'Nature of legal matter' },
              { field: 'conflict_check', required: true, customLabel: 'Opposing party name (for conflict check)' },
            ],
          },
          afterHours: {
            action: 'take_message',
            infoToCollect: [
              ...BASE_INFO_FIELDS,
              { field: 'case_nature', required: true, customLabel: 'Nature of legal matter' },
            ],
          },
        },
      },
      {
        id: crypto.randomUUID(),
        name: 'Existing Client',
        timeConditions: {
          businessHours: { action: 'patch', infoToCollect: [...BASE_INFO_FIELDS] },
          afterHours: { action: 'patch', infoToCollect: [...BASE_INFO_FIELDS] },
        },
      },
      {
        id: crypto.randomUUID(),
        name: 'Opposing Counsel',
        timeConditions: {
          businessHours: {
            action: 'take_message',
            infoToCollect: [...BASE_INFO_FIELDS, { field: 'firm_name', required: false, customLabel: 'Firm name' }],
          },
          afterHours: {
            action: 'take_message',
            infoToCollect: [...BASE_INFO_FIELDS, { field: 'firm_name', required: false, customLabel: 'Firm name' }],
          },
        },
      },
      {
        id: crypto.randomUUID(),
        name: 'Emergency',
        timeConditions: { always: { action: 'patch', infoToCollect: [...BASE_INFO_FIELDS] } },
      },
    ],
    messageDelivery: { globalDefaults: { channels: ['email'], urgentSmsEnabled: false } },
    escalation: { enabled: false },
  }
}

function getRealEstatePresets(): VerticalPresets {
  return {
    greeting: { template: 'real_estate-1', presentAs: 'employee', language: 'english' },
    businessHours: { type: 'custom', timezone: 'America/New_York', customHours: standardWeekdayHours() },
    callTypes: [
      {
        id: crypto.randomUUID(),
        name: 'Property Inquiry',
        timeConditions: {
          businessHours: {
            action: 'screen_and_patch',
            infoToCollect: [...BASE_INFO_FIELDS, { field: 'property_interest', required: false, customLabel: 'Property of interest' }],
          },
          afterHours: {
            action: 'take_message',
            infoToCollect: [...BASE_INFO_FIELDS, { field: 'property_interest', required: false, customLabel: 'Property of interest' }],
          },
        },
      },
      {
        id: crypto.randomUUID(),
        name: 'Showing Request',
        timeConditions: {
          businessHours: {
            action: 'take_message',
            infoToCollect: [
              ...BASE_INFO_FIELDS,
              { field: 'property_interest', required: true, customLabel: 'Property of interest' },
              { field: 'preferred_times', required: false, customLabel: 'Preferred showing times' },
            ],
          },
          afterHours: {
            action: 'take_message',
            infoToCollect: [
              ...BASE_INFO_FIELDS,
              { field: 'property_interest', required: true, customLabel: 'Property of interest' },
              { field: 'preferred_times', required: false, customLabel: 'Preferred showing times' },
            ],
          },
        },
      },
      {
        id: crypto.randomUUID(),
        name: 'Existing Client',
        timeConditions: { always: { action: 'patch', infoToCollect: [...BASE_INFO_FIELDS] } },
      },
      {
        id: crypto.randomUUID(),
        name: 'Urgent Maintenance',
        timeConditions: {
          always: {
            action: 'patch',
            infoToCollect: [
              ...BASE_INFO_FIELDS,
              { field: 'property_address', required: true, customLabel: 'Property address' },
              { field: 'issue_description', required: true, customLabel: 'Issue description' },
            ],
          },
        },
      },
    ],
    messageDelivery: { globalDefaults: { channels: ['email'], urgentSmsEnabled: false } },
    escalation: { enabled: false },
  }
}

function getProfessionalServicesPresets(): VerticalPresets {
  return {
    greeting: { template: 'template-2', presentAs: 'answering_service', language: 'english' },
    businessHours: { type: 'custom', timezone: 'America/New_York', customHours: standardWeekdayHours() },
    callTypes: [
      {
        id: crypto.randomUUID(),
        name: 'New Client Inquiry',
        timeConditions: {
          businessHours: {
            action: 'screen_and_patch',
            infoToCollect: [
              ...BASE_INFO_FIELDS,
              { field: 'company_name', required: false, customLabel: 'Company name' },
              { field: 'inquiry_nature', required: true, customLabel: 'Nature of inquiry' },
            ],
          },
          afterHours: {
            action: 'take_message',
            infoToCollect: [
              ...BASE_INFO_FIELDS,
              { field: 'company_name', required: false, customLabel: 'Company name' },
              { field: 'inquiry_nature', required: true, customLabel: 'Nature of inquiry' },
            ],
          },
        },
      },
      {
        id: crypto.randomUUID(),
        name: 'Existing Client',
        timeConditions: {
          businessHours: { action: 'patch', infoToCollect: [...BASE_INFO_FIELDS] },
          afterHours: { action: 'take_message', infoToCollect: [...BASE_INFO_FIELDS] },
        },
      },
      {
        id: crypto.randomUUID(),
        name: 'General Inquiry',
        timeConditions: { always: { action: 'take_message', infoToCollect: [...BASE_INFO_FIELDS] } },
      },
      {
        id: crypto.randomUUID(),
        name: 'Urgent',
        timeConditions: { always: { action: 'patch', infoToCollect: [...BASE_INFO_FIELDS] } },
      },
    ],
    messageDelivery: { globalDefaults: { channels: ['email'], urgentSmsEnabled: false } },
    escalation: { enabled: false },
  }
}

function getOtherPresets(): VerticalPresets {
  return {
    greeting: { template: 'template-1', presentAs: 'employee', language: 'english' },
    businessHours: { type: '24_7', timezone: 'America/New_York' },
    callTypes: [
      {
        id: crypto.randomUUID(),
        name: 'General Inquiry',
        timeConditions: { always: { action: 'take_message', infoToCollect: [...BASE_INFO_FIELDS] } },
      },
      {
        id: crypto.randomUUID(),
        name: 'Urgent',
        timeConditions: { always: { action: 'patch', infoToCollect: [...BASE_INFO_FIELDS] } },
      },
    ],
    messageDelivery: { globalDefaults: { channels: ['email'], urgentSmsEnabled: false } },
    escalation: { enabled: false },
  }
}

// Placeholder stubs — will be replaced in Task 3
function getMedicalPresets(): VerticalPresets { return getOtherPresets() }
function getHomeServicesPresets(): VerticalPresets { return getOtherPresets() }

/**
 * Returns vertical-specific defaults for all wizard steps 1–5.
 * All call type UUIDs are generated fresh per call — do not cache the result.
 */
export function getVerticalPresets(industry: Industry): VerticalPresets {
  switch (industry) {
    case 'legal':                return getLegalPresets()
    case 'medical':              return getMedicalPresets()
    case 'home_services':        return getHomeServicesPresets()
    case 'real_estate':          return getRealEstatePresets()
    case 'professional_services': return getProfessionalServicesPresets()
    default:                     return getOtherPresets()
  }
}

export function applyVerticalPresets(_industry: Industry, _currentValues: AnsweringServiceSetup): VerticalPresets | null {
  throw new Error('Not implemented yet')
}
