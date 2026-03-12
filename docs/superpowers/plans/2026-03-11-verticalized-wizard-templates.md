# Verticalized Wizard Templates Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pre-populate wizard Steps 1–5 with industry-specific defaults when a business client advances past Step 0, cutting time-to-value from days to hours.

**Architecture:** One new pure-TypeScript module (`verticalPresets.ts`) owns all vertical data and the idempotency gate. The wizard shell calls `applyVerticalPresets()` in `handleNext` on the Step 0 → Step 1 transition. Two existing step components lose their scattered inline presets and import from the new module instead.

**Tech Stack:** TypeScript strict, Zod schema types (`answeringServiceSchema.ts`), react-hook-form `setValue`, Jest for unit tests.

---

## Spec Correction

The design spec listed `type: 'standard'` for legal, real_estate, professional_services, and other. **`standard` has no radio button in `BusinessHoursStep.tsx`** — only `24_7` and `custom` are rendered. Writing `standard` to the form leaves Step 2 with no radio selected and blocks navigation.

**Correction applied in this plan:**
- legal → `type: 'custom'`, M–F 9–5, Sat–Sun closed
- real_estate → `type: 'custom'`, M–F 9–5, Sat–Sun closed
- professional_services → `type: 'custom'`, M–F 9–5, Sat–Sun closed
- other → `type: '24_7'` (keep pristine default; hours are unknown for "other")

Day format: lowercase strings (`'monday'`…`'sunday'`). Time format: `'9:00 AM'` / `'5:00 PM'` (no leading zero, space before AM/PM) — matches `BusinessHoursStep`'s `generateTimeOptions()` output.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| **Create** | `lib/services/answering-service/verticalPresets.ts` | All vertical preset data, idempotency gate |
| **Create** | `__tests__/lib/services/answering-service/verticalPresets.test.ts` | Unit tests for the above |
| **Modify** | `components/answering-service/steps/GreetingScriptStep.tsx` | Remove inline template constants; import from verticalPresets |
| **Modify** | `components/answering-service/steps/CallTypesStep.tsx` | Remove getIndustryPresets, useEffect, useToast |
| **Modify** | `components/answering-service/SetupWizardClient.tsx` | Add applyVerticalPresets call in handleNext |

---

## Chunk 1: Build `verticalPresets.ts`

### Task 1: Scaffold the module and implement `getIndustryGreetingTemplates`

**Files:**
- Create: `lib/services/answering-service/verticalPresets.ts`
- Create: `__tests__/lib/services/answering-service/verticalPresets.test.ts`

- [ ] **Step 1: Create the test file with failing tests for `getIndustryGreetingTemplates`**

```typescript
// __tests__/lib/services/answering-service/verticalPresets.test.ts
import {
  getIndustryGreetingTemplates,
  getVerticalPresets,
  applyVerticalPresets,
} from '@/lib/services/answering-service/verticalPresets'
import type { AnsweringServiceSetup } from '@/schemas/answeringServiceSchema'

describe('getIndustryGreetingTemplates', () => {
  const industries = [
    'legal', 'medical', 'home_services',
    'real_estate', 'professional_services', 'other',
  ] as const

  it.each(industries)('last entry is always custom for %s', (industry) => {
    const templates = getIndustryGreetingTemplates(industry)
    expect(templates.at(-1)).toEqual({ id: 'custom', text: 'Custom' })
  })

  it('includes industry-specific templates for legal', () => {
    const ids = getIndustryGreetingTemplates('legal').map(t => t.id)
    expect(ids).toContain('legal-1')
    expect(ids).toContain('legal-2')
  })

  it('includes industry-specific templates for medical', () => {
    const ids = getIndustryGreetingTemplates('medical').map(t => t.id)
    expect(ids).toContain('medical-1')
  })

  it('includes industry-specific templates for real_estate', () => {
    const ids = getIndustryGreetingTemplates('real_estate').map(t => t.id)
    expect(ids).toContain('real_estate-1')
  })

  it('returns base templates for home_services (no industry-specific)', () => {
    const ids = getIndustryGreetingTemplates('home_services').map(t => t.id)
    expect(ids).toContain('template-1')
    expect(ids).not.toContain('home_services-1')
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npx jest --testPathPattern=verticalPresets --no-coverage
```

Expected: FAIL — `Cannot find module '@/lib/services/answering-service/verticalPresets'`

- [ ] **Step 3: Create the module scaffold with types, BASE_TEMPLATES, and `getIndustryGreetingTemplates`**

```typescript
// lib/services/answering-service/verticalPresets.ts
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
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npx jest --testPathPattern=verticalPresets --no-coverage
```

Expected: PASS (all `getIndustryGreetingTemplates` tests green)

- [ ] **Step 5: Commit**

```bash
git add lib/services/answering-service/verticalPresets.ts \
        __tests__/lib/services/answering-service/verticalPresets.test.ts
git commit -m "feat: scaffold verticalPresets module with greeting templates"
```

---

### Task 2: Add presets for legal, real_estate, professional_services, and other

These four verticals have no escalation rules, so there's no UUID-linkage complexity.

**Files:**
- Modify: `lib/services/answering-service/verticalPresets.ts`
- Modify: `__tests__/lib/services/answering-service/verticalPresets.test.ts`

- [ ] **Step 1: Add failing tests**

```typescript
// Add to verticalPresets.test.ts

// Shared fixture — all five keys present
function expectFullShape(presets: ReturnType<typeof getVerticalPresets>) {
  expect(presets).toMatchObject({
    greeting: expect.objectContaining({ template: expect.any(String) }),
    businessHours: expect.objectContaining({ type: expect.any(String) }),
    callTypes: expect.any(Array),
    messageDelivery: expect.objectContaining({ globalDefaults: expect.any(Object) }),
    escalation: expect.objectContaining({ enabled: expect.any(Boolean) }),
  })
}

describe('getVerticalPresets — non-escalation verticals', () => {
  it('legal: returns full shape', () => {
    expectFullShape(getVerticalPresets('legal'))
  })

  it('legal: auto-selected greeting template exists in dropdown', () => {
    const presets = getVerticalPresets('legal')
    const ids = getIndustryGreetingTemplates('legal').map(t => t.id)
    expect(ids).toContain(presets.greeting.template)
  })

  it('legal: businessHours type is custom', () => {
    expect(getVerticalPresets('legal').businessHours.type).toBe('custom')
  })

  it('legal: escalation is disabled', () => {
    expect(getVerticalPresets('legal').escalation.enabled).toBe(false)
  })

  it('legal: has 4 call types', () => {
    expect(getVerticalPresets('legal').callTypes).toHaveLength(4)
  })

  it('real_estate: auto-selected template exists in dropdown', () => {
    const presets = getVerticalPresets('real_estate')
    const ids = getIndustryGreetingTemplates('real_estate').map(t => t.id)
    expect(ids).toContain(presets.greeting.template)
  })

  it('real_estate: greeting template is real_estate-1', () => {
    expect(getVerticalPresets('real_estate').greeting.template).toBe('real_estate-1')
  })

  it('professional_services: presentAs is answering_service', () => {
    expect(getVerticalPresets('professional_services').greeting.presentAs).toBe('answering_service')
  })

  it('other: returns non-null (regression guard)', () => {
    expect(getVerticalPresets('other')).not.toBeNull()
  })

  it('other: has at least 2 call types', () => {
    expect(getVerticalPresets('other').callTypes.length).toBeGreaterThanOrEqual(2)
  })

  it('other: businessHours type is 24_7', () => {
    expect(getVerticalPresets('other').businessHours.type).toBe('24_7')
  })
})
```

- [ ] **Step 2: Run to confirm failures**

```bash
npx jest --testPathPattern=verticalPresets --no-coverage
```

Expected: FAIL — `getVerticalPresets is not a function`

- [ ] **Step 3: Implement shared helpers and non-escalation presets**

Add to `lib/services/answering-service/verticalPresets.ts`:

```typescript
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

/**
 * Returns vertical-specific defaults for all wizard steps 1–5.
 * All call type UUIDs are generated fresh per call — do not cache the result.
 */
export function getVerticalPresets(industry: Industry): VerticalPresets {
  switch (industry) {
    case 'legal':                return getLegalPresets()
    case 'medical':              return getMedicalPresets()      // implemented in Task 3
    case 'home_services':        return getHomeServicesPresets() // implemented in Task 3
    case 'real_estate':          return getRealEstatePresets()
    case 'professional_services': return getProfessionalServicesPresets()
    default:                     return getOtherPresets()
  }
}

// Placeholder stubs — will be replaced in Task 3
function getMedicalPresets(): VerticalPresets { return getOtherPresets() }
function getHomeServicesPresets(): VerticalPresets { return getOtherPresets() }
```

- [ ] **Step 4: Run tests**

```bash
npx jest --testPathPattern=verticalPresets --no-coverage
```

Expected: All non-escalation tests pass. `medical` / `home_services` tests (from Task 3) are not written yet.

- [ ] **Step 5: Commit**

```bash
git add lib/services/answering-service/verticalPresets.ts \
        __tests__/lib/services/answering-service/verticalPresets.test.ts
git commit -m "feat: add vertical presets for legal, real_estate, professional_services, other"
```

---

### Task 3: Add escalation presets for medical and home_services

These two verticals generate escalation rules whose keys must match specific call type UUIDs. All IDs are generated inside the factory function and shared between `callTypes` and `escalation.callTypeRules`.

**Files:**
- Modify: `lib/services/answering-service/verticalPresets.ts`
- Modify: `__tests__/lib/services/answering-service/verticalPresets.test.ts`

- [ ] **Step 1: Add UUID-linkage tests**

```typescript
// Add to verticalPresets.test.ts

describe('getVerticalPresets — escalation verticals', () => {
  it('medical: escalation is enabled', () => {
    expect(getVerticalPresets('medical').escalation.enabled).toBe(true)
  })

  it('medical: escalation.callTypeRules keys all match a callType id', () => {
    const presets = getVerticalPresets('medical')
    const callTypeIds = new Set(presets.callTypes.map(ct => ct.id))
    const ruleKeys = Object.keys(presets.escalation.callTypeRules ?? {})
    expect(ruleKeys.length).toBeGreaterThan(0)
    ruleKeys.forEach(key => expect(callTypeIds).toContain(key))
  })

  it('medical: Urgent Medical callType has canEscalate=true in escalation rules', () => {
    const presets = getVerticalPresets('medical')
    const urgentCt = presets.callTypes.find(ct => ct.name === 'Urgent Medical')
    expect(urgentCt).toBeDefined()
    const rule = presets.escalation.callTypeRules?.[urgentCt!.id]
    expect(rule?.canEscalate).toBe(true)
    expect(rule?.timeCondition).toBe('24_hours')
  })

  it('medical: auto-selected template exists in dropdown', () => {
    const presets = getVerticalPresets('medical')
    const ids = getIndustryGreetingTemplates('medical').map(t => t.id)
    expect(ids).toContain(presets.greeting.template)
  })

  it('medical: channels include sms and urgentSmsEnabled is true', () => {
    const presets = getVerticalPresets('medical')
    expect(presets.messageDelivery.globalDefaults.channels).toContain('sms')
    expect(presets.messageDelivery.globalDefaults.urgentSmsEnabled).toBe(true)
  })

  it('medical: businessHours type is custom', () => {
    expect(getVerticalPresets('medical').businessHours.type).toBe('custom')
  })

  it('home_services: escalation.callTypeRules keys all match a callType id', () => {
    const presets = getVerticalPresets('home_services')
    const callTypeIds = new Set(presets.callTypes.map(ct => ct.id))
    const ruleKeys = Object.keys(presets.escalation.callTypeRules ?? {})
    expect(ruleKeys.length).toBeGreaterThan(0)
    ruleKeys.forEach(key => expect(callTypeIds).toContain(key))
  })

  it('home_services: Emergency Service callType has canEscalate=true', () => {
    const presets = getVerticalPresets('home_services')
    const emergencyCt = presets.callTypes.find(ct => ct.name === 'Emergency Service')
    expect(emergencyCt).toBeDefined()
    const rule = presets.escalation.callTypeRules?.[emergencyCt!.id]
    expect(rule?.canEscalate).toBe(true)
  })

  it('home_services: businessHours type is 24_7', () => {
    expect(getVerticalPresets('home_services').businessHours.type).toBe('24_7')
  })
})
```

- [ ] **Step 2: Run to confirm failures**

```bash
npx jest --testPathPattern=verticalPresets --no-coverage
```

Expected: FAIL — UUID linkage tests and medical-specific assertions fail (stubs return getOtherPresets).

- [ ] **Step 3: Replace the stub implementations with real factories**

Replace the placeholder `getMedicalPresets` and `getHomeServicesPresets` stubs in `verticalPresets.ts`:

```typescript
function getMedicalPresets(): VerticalPresets {
  const newPatientId = crypto.randomUUID()
  const existingPatientId = crypto.randomUUID()
  const pharmacyId = crypto.randomUUID()
  const urgentMedicalId = crypto.randomUUID()

  return {
    greeting: { template: 'medical-1', presentAs: 'employee', language: 'english' },
    businessHours: { type: 'custom', timezone: 'America/New_York', customHours: medicalWeekdayHours() },
    callTypes: [
      {
        id: newPatientId,
        name: 'New Patient',
        timeConditions: {
          businessHours: {
            action: 'take_message',
            infoToCollect: [...BASE_INFO_FIELDS, { field: 'date_of_birth', required: true, customLabel: 'Date of birth' }],
          },
          afterHours: {
            action: 'take_message',
            infoToCollect: [...BASE_INFO_FIELDS, { field: 'date_of_birth', required: true, customLabel: 'Date of birth' }],
          },
        },
      },
      {
        id: existingPatientId,
        name: 'Existing Patient',
        timeConditions: {
          businessHours: {
            action: 'screen_and_patch',
            infoToCollect: [...BASE_INFO_FIELDS, { field: 'date_of_birth', required: true, customLabel: 'Date of birth' }],
          },
          afterHours: {
            action: 'take_message',
            infoToCollect: [...BASE_INFO_FIELDS, { field: 'date_of_birth', required: true, customLabel: 'Date of birth' }],
          },
        },
      },
      {
        id: pharmacyId,
        name: 'Pharmacy/Provider',
        timeConditions: {
          always: {
            action: 'patch',
            infoToCollect: [...BASE_INFO_FIELDS, { field: 'provider_name', required: false, customLabel: 'Pharmacy or provider name' }],
          },
        },
      },
      {
        id: urgentMedicalId,
        name: 'Urgent Medical',
        timeConditions: {
          always: {
            action: 'patch',
            infoToCollect: [...BASE_INFO_FIELDS, { field: 'emergency_nature', required: true, customLabel: 'Nature of emergency' }],
          },
        },
      },
    ],
    messageDelivery: { globalDefaults: { channels: ['email', 'sms'], urgentSmsEnabled: true } },
    escalation: {
      enabled: true,
      callTypeRules: {
        [urgentMedicalId]: {
          canEscalate: true,
          criteria: 'Patient reports emergency symptoms',
          timeCondition: '24_hours',
        },
      },
      globalEscalationContact: '',
    },
  }
}

function getHomeServicesPresets(): VerticalPresets {
  const serviceRequestId = crypto.randomUUID()
  const emergencyServiceId = crypto.randomUUID()
  const existingCustomerId = crypto.randomUUID()

  return {
    greeting: { template: 'template-1', presentAs: 'employee', language: 'english' },
    businessHours: { type: '24_7', timezone: 'America/New_York' },
    callTypes: [
      {
        id: serviceRequestId,
        name: 'Service Request',
        timeConditions: {
          businessHours: {
            action: 'take_message',
            infoToCollect: [
              ...BASE_INFO_FIELDS,
              { field: 'service_address', required: true, customLabel: 'Service address' },
              { field: 'issue_description', required: true, customLabel: 'Issue description' },
            ],
          },
          afterHours: {
            action: 'take_message',
            infoToCollect: [
              ...BASE_INFO_FIELDS,
              { field: 'service_address', required: true, customLabel: 'Service address' },
              { field: 'issue_description', required: true, customLabel: 'Issue description' },
            ],
          },
        },
      },
      {
        id: emergencyServiceId,
        name: 'Emergency Service',
        timeConditions: {
          always: {
            action: 'patch',
            infoToCollect: [
              ...BASE_INFO_FIELDS,
              { field: 'service_address', required: true, customLabel: 'Service address' },
              { field: 'emergency_nature', required: true, customLabel: 'Nature of emergency' },
            ],
          },
        },
      },
      {
        id: existingCustomerId,
        name: 'Existing Customer',
        timeConditions: {
          businessHours: { action: 'screen_and_patch', infoToCollect: [...BASE_INFO_FIELDS] },
          afterHours: { action: 'take_message', infoToCollect: [...BASE_INFO_FIELDS] },
        },
      },
    ],
    messageDelivery: { globalDefaults: { channels: ['email', 'sms'], urgentSmsEnabled: true } },
    escalation: {
      enabled: true,
      callTypeRules: {
        [emergencyServiceId]: {
          canEscalate: true,
          criteria: 'Property damage or safety emergency',
          timeCondition: '24_hours',
        },
      },
      globalEscalationContact: '',
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest --testPathPattern=verticalPresets --no-coverage
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/services/answering-service/verticalPresets.ts \
        __tests__/lib/services/answering-service/verticalPresets.test.ts
git commit -m "feat: add vertical presets for medical and home_services with escalation UUID linkage"
```

---

### Task 4: Implement `applyVerticalPresets` and `isPristine`

**Files:**
- Modify: `lib/services/answering-service/verticalPresets.ts`
- Modify: `__tests__/lib/services/answering-service/verticalPresets.test.ts`

- [ ] **Step 1: Add failing tests**

```typescript
// Add to verticalPresets.test.ts

// Reusable pristine fixture
const PRISTINE: AnsweringServiceSetup = {
  profile: { businessName: 'Acme', contactName: 'Alice', email: 'alice@acme.com', phone: '', industry: 'legal' },
  greeting: { template: '', presentAs: 'answering_service', language: 'english' },
  businessHours: { type: '24_7', timezone: 'America/New_York' },
  callTypes: [],
  callHandling: { defaultAction: 'take_message', patchNumber: '', screeningQuestions: [] },
  messageDelivery: { globalDefaults: { channels: ['email'], urgentSmsEnabled: false, emailAddress: '' } },

  escalation: { enabled: false },
  billingConfirm: { planTier: '', confirmedTerms: false },
}

describe('applyVerticalPresets', () => {
  it('returns presets for a pristine form with a known industry', () => {
    expect(applyVerticalPresets('legal', PRISTINE)).not.toBeNull()
  })

  it('returns null when greeting.template is non-empty', () => {
    const dirty = { ...PRISTINE, greeting: { ...PRISTINE.greeting, template: 'template-1' } }
    expect(applyVerticalPresets('legal', dirty)).toBeNull()
  })

  it('returns null when callTypes is non-empty', () => {
    const dirty = {
      ...PRISTINE,
      callTypes: [{ id: 'x', name: 'Test', timeConditions: { always: { action: 'take_message' as const } } }],
    }
    expect(applyVerticalPresets('legal', dirty)).toBeNull()
  })

  it('returns null when businessHours.type is not 24_7', () => {
    const dirty = { ...PRISTINE, businessHours: { ...PRISTINE.businessHours, type: 'custom' as const } }
    expect(applyVerticalPresets('legal', dirty)).toBeNull()
  })

  it('returns null when businessHours.customHours is set', () => {
    const dirty = {
      ...PRISTINE,
      businessHours: { ...PRISTINE.businessHours, customHours: [{ day: 'monday', open: '9:00 AM', close: '5:00 PM', closed: false }] },
    }
    expect(applyVerticalPresets('legal', dirty)).toBeNull()
  })

  it('returns null when escalation is enabled', () => {
    const dirty = { ...PRISTINE, escalation: { enabled: true, globalEscalationContact: '555-1234' } }
    expect(applyVerticalPresets('legal', dirty)).toBeNull()
  })

  it('returns null when emailAddress is non-empty', () => {
    const dirty = {
      ...PRISTINE,
      messageDelivery: {
        globalDefaults: { ...PRISTINE.messageDelivery.globalDefaults, emailAddress: 'test@test.com' },
      },
    }
    expect(applyVerticalPresets('legal', dirty)).toBeNull()
  })

  it('returns null when urgentSmsEnabled is true', () => {
    const dirty = {
      ...PRISTINE,
      messageDelivery: {
        globalDefaults: { ...PRISTINE.messageDelivery.globalDefaults, urgentSmsEnabled: true },
      },
    }
    expect(applyVerticalPresets('legal', dirty)).toBeNull()
  })

  it('returns generic presets (not null) for other industry — regression guard', () => {
    const otherPristine = { ...PRISTINE, profile: { ...PRISTINE.profile, industry: 'other' as const } }
    expect(applyVerticalPresets('other', otherPristine)).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run to confirm failures**

```bash
npx jest --testPathPattern=verticalPresets --no-coverage
```

Expected: FAIL — `applyVerticalPresets is not a function`

- [ ] **Step 3: Implement `isPristine` and `applyVerticalPresets`**

Add to `lib/services/answering-service/verticalPresets.ts`:

```typescript
// ─── Idempotency Gate ─────────────────────────────────────────────────────────

/**
 * Returns true if all downstream wizard steps (1–5) are still at their
 * empty default values — i.e., the user hasn't filled anything in yet.
 *
 * Note: home_services uses businessHours.type '24_7' (same as pristine default),
 * so the businessHours sentinel does not distinguish pre-populated from pristine
 * for that vertical. The greeting.template and callTypes sentinels are
 * load-bearing for home_services idempotency.
 */
function isPristine(currentValues: AnsweringServiceSetup): boolean {
  const { greeting, callTypes, businessHours, messageDelivery, escalation } = currentValues
  return (
    greeting.template === '' &&
    callTypes.length === 0 &&
    businessHours.type === '24_7' &&
    !businessHours.customHours &&
    messageDelivery.globalDefaults.channels.length === 1 &&
    messageDelivery.globalDefaults.channels[0] === 'email' &&
    !messageDelivery.globalDefaults.urgentSmsEnabled &&
    (!messageDelivery.globalDefaults.emailAddress || messageDelivery.globalDefaults.emailAddress === '') &&
    !escalation.enabled
  )
}

/**
 * Returns vertical-specific defaults if the form is still pristine, null otherwise.
 * Call this in SetupWizardClient.handleNext after step 0 validates.
 *
 * Returns null if:
 * - Any downstream step has non-default data (first-touch-only rule)
 *
 * Always returns a non-null preset for 'other' when pristine (regression guard —
 * the previous CallTypesStep useEffect pre-populated 'other' with generic call types).
 */
export function applyVerticalPresets(
  industry: Industry,
  currentValues: AnsweringServiceSetup,
): VerticalPresets | null {
  if (!isPristine(currentValues)) return null
  return getVerticalPresets(industry)
}
```

- [ ] **Step 4: Run all tests**

```bash
npx jest --testPathPattern=verticalPresets --no-coverage
```

Expected: All ~28 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/services/answering-service/verticalPresets.ts \
        __tests__/lib/services/answering-service/verticalPresets.test.ts
git commit -m "feat: add applyVerticalPresets with first-touch-only idempotency gate"
```

---

## Chunk 2: Integrate

### Task 5: Refactor `GreetingScriptStep.tsx`

Remove the inline template constants and replace with the new module import. Behaviour is unchanged — only the data source moves.

**Files:**
- Modify: `components/answering-service/steps/GreetingScriptStep.tsx`

- [ ] **Step 1: Delete `LEGAL_TEMPLATES` and `MEDICAL_TEMPLATES`**

In `GreetingScriptStep.tsx`, delete lines 24–37 (includes the JSDoc comment blocks above each constant):

```typescript
// DELETE all of this:
/**
 * Legal industry-specific templates
 */
const LEGAL_TEMPLATES = [
  { id: 'legal-1', text: 'Law offices of {business_name}. How may I direct your call?' },
  { id: 'legal-2', text: '{business_name}. Are you a new or existing client?' },
]

/**
 * Medical industry-specific templates
 */
const MEDICAL_TEMPLATES = [
  { id: 'medical-1', text: '{business_name}. Is this regarding an appointment or a medical concern?' },
]
```

- [ ] **Step 2: Add the import**

Add to the imports at the top of `GreetingScriptStep.tsx`:

```typescript
import { getIndustryGreetingTemplates } from '@/lib/services/answering-service/verticalPresets'
```

- [ ] **Step 3: Replace `availableTemplates` useMemo**

Replace the existing `availableTemplates` useMemo (lines 61–71) with:

```typescript
const availableTemplates = useMemo(
  () => getIndustryGreetingTemplates(profileIndustry),
  [profileIndustry],
)
```

The `useMemo` dependency changes from `[profileIndustry]` (same) — the only change is delegating to the new module. The `BASE_TEMPLATES` constant defined in this file is no longer used and can be deleted.

- [ ] **Step 4: Delete `BASE_TEMPLATES` from `GreetingScriptStep.tsx`**

Remove lines 16–22 (the `BASE_TEMPLATES` constant). It is now defined in `verticalPresets.ts`.

- [ ] **Step 5: Run tests to verify no regressions**

```bash
npx jest --no-coverage
```

Expected: All tests pass. (There may be no component tests for GreetingScriptStep — that's fine; the unit tests for `getIndustryGreetingTemplates` already cover the logic.)

- [ ] **Step 6: Commit**

```bash
git add components/answering-service/steps/GreetingScriptStep.tsx
git commit -m "refactor: remove inline greeting templates from GreetingScriptStep; import from verticalPresets"
```

---

### Task 6: Refactor `CallTypesStep.tsx`

Remove the pre-population logic that is now centralized in the wizard shell.

**Files:**
- Modify: `components/answering-service/steps/CallTypesStep.tsx`

- [ ] **Step 1: Delete `getIndustryPresets()` function**

Delete lines 12–173 — the entire `getIndustryPresets()` function.

- [ ] **Step 2: Delete the pre-population `useEffect` and `hasPrePopulated` ref**

Delete:
- Line 192: `const hasPrePopulated = useRef(false)`
- Lines 211–221: the `useEffect` that calls `append(preset)` and shows a toast

Also delete from the `useFieldArray` destructure: `append` is still used by `handleAddNew`, so keep it. Only the `useEffect` body is deleted.

- [ ] **Step 3: Delete `useToast` and `toast`**

- Delete the `useToast` import: `import { useToast } from '@/components/ui/use-toast'`
- Delete line 191: `const { toast } = useToast()`

`toast` is only used in the deleted `useEffect` — nowhere else in the component.

- [ ] **Step 4: Verify `getIndustryLabel` and `industryExamples` remain**

Confirm these still exist in the file (they render helper text in the UI and are unrelated to pre-population):
- `getIndustryLabel()` function
- `const industryExamples = useMemo(...)` inside the component

Both `useRef` and `useEffect` are now unused — remove both from the React import:
```typescript
// Before:
import { useState, useEffect, useRef, useMemo } from 'react'
// After:
import { useState, useMemo } from 'react'
```

- [ ] **Step 5: Run tests to verify no regressions**

```bash
npx jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add components/answering-service/steps/CallTypesStep.tsx
git commit -m "refactor: remove step-local pre-population from CallTypesStep; centralized in wizard shell"
```

---

### Task 7: Integrate `applyVerticalPresets` into `SetupWizardClient`

Wire the new module into the wizard's `handleNext` function.

**Files:**
- Modify: `components/answering-service/SetupWizardClient.tsx`

- [ ] **Step 1: Add the import**

At the top of `SetupWizardClient.tsx`, add:

```typescript
import { applyVerticalPresets } from '@/lib/services/answering-service/verticalPresets'
```

- [ ] **Step 2: Add the pre-population block to `handleNext`**

In `handleNext`, immediately after the `if (!isValid) { ... return }` block and before the `if (currentStep < STEPS.length - 1)` check, insert:

```typescript
// Pre-populate Steps 1–5 with vertical defaults on first advance past Step 0
if (currentStep === 0) {
  const industry = methods.getValues('profile.industry')
  if (!industry) return // narrows '' away for TypeScript; unreachable at runtime (validation just passed)
  const presets = applyVerticalPresets(industry, methods.getValues())
  if (presets) {
    methods.setValue('greeting', presets.greeting)
    methods.setValue('businessHours', presets.businessHours)
    methods.setValue('callTypes', presets.callTypes)
    methods.setValue('messageDelivery', presets.messageDelivery)
    methods.setValue('escalation', presets.escalation)
    toast({
      title: 'Defaults pre-filled',
      description: "We've applied industry defaults — customize them as you go.",
    })
  }
}
```

The existing debounced session watcher (`methods.watch` subscription, line 141) will capture these `setValue` calls automatically within 300ms — no explicit `updateSession` call needed.

- [ ] **Step 3: Run all tests**

```bash
npx jest --no-coverage
```

Expected: All tests pass.

- [ ] **Step 4: Smoke-test manually (optional but recommended)**

Start the dev server and complete the following flow:
1. Create a new wizard session
2. Fill in profile with industry = `medical`
3. Click "Next →"
4. Confirm toast appears: "Defaults pre-filled"
5. Check Step 1 (Greeting): a template is selected, preview shows medical greeting
6. Check Step 2 (Business Hours): `custom` is selected, M–F rows show 8am–5pm, Sat–Sun checked as closed
7. Check Step 3 (Call Types): 4 call types present including "Urgent Medical"
8. Check Step 5 (Escalation): enabled toggle is on, Urgent Medical has escalation rule, `globalEscalationContact` is empty (Step 5 validation will block until filled)
9. Go back to Step 0, change industry to `legal`, click Next — confirm toast does NOT re-appear (idempotency)

- [ ] **Step 5: Commit**

```bash
git add components/answering-service/SetupWizardClient.tsx
git commit -m "feat: pre-populate wizard steps 1–5 with vertical defaults on Step 0 completion"
```
