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

// Placeholder stubs for getVerticalPresets and applyVerticalPresets - will be filled in later tasks
export function getVerticalPresets(_industry: Industry): VerticalPresets {
  throw new Error('Not implemented yet')
}

export function applyVerticalPresets(_industry: Industry, _currentValues: AnsweringServiceSetup): VerticalPresets | null {
  throw new Error('Not implemented yet')
}
