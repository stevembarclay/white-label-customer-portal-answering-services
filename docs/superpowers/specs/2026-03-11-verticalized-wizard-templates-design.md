# Verticalized Wizard Templates — Design Spec

**Date:** 2026-03-11
**Status:** Approved
**Goal:** Cut time-to-value from days to hours by pre-populating wizard Steps 1–5 with industry-specific defaults when a business client advances past Step 0 (profile/industry selection).

---

## Problem

The setup wizard currently starts every business with blank or generic defaults regardless of their industry. A medical practice and a home services company face identical empty forms. Operators report that clients take days to complete setup because they don't know what "sensible" looks like for their industry.

Additionally, the codebase has grown scattered vertical logic: `CallTypesStep.tsx` has an inline `getIndustryPresets()` function, and `GreetingScriptStep.tsx` has inline `LEGAL_TEMPLATES` and `MEDICAL_TEMPLATES` constants. Both are incomplete (missing real_estate and professional_services) and uncoordinated.

---

## Approach

Centralized pre-population service triggered from the wizard shell's `handleNext` on the Step 0 → Step 1 transition. One new file. Three existing files refactored.

Rejected alternatives:
- **Step-local `useEffect` pattern** (current approach in CallTypesStep): can't share UUIDs between Step 3 (call types) and Step 5 (escalation rules), idempotency logic would be scattered across five components.
- **Custom hook**: same architecture as the chosen approach but adds indirection without reactive benefit — the logic is pure data generation, not reactive state.

---

## Architecture

### New file: `lib/services/answering-service/verticalPresets.ts`

Pure TypeScript, no React, no Supabase. Exports:

#### Types

```typescript
type Template = { id: string; text: string }

type VerticalPresets = {
  greeting: Greeting          // from answeringServiceSchema
  businessHours: BusinessHours
  callTypes: CallTypes
  messageDelivery: MessageDelivery
  escalation: Escalation
}
```

`Greeting`, `BusinessHours`, `CallTypes`, `MessageDelivery`, and `Escalation` are the types inferred from the named Zod schemas in `answeringServiceSchema.ts`.

#### `BASE_TEMPLATES: Template[]`
The five base greeting templates available to all industries (previously defined inline in `GreetingScriptStep.tsx`). Moved here to be the single source of truth.

#### `getIndustryGreetingTemplates(industry: Industry): Template[]`
Returns the full ordered template list for the dropdown: base templates (minus "Custom") + industry-specific templates + "Custom" last. Template IDs defined in this function are canonical — they must exactly match the IDs written into `greeting.template` by `getVerticalPresets`. `GreetingScriptStep` calls this instead of building the list itself.

#### `getVerticalPresets(industry: Industry): VerticalPresets`
Factory that returns `{ greeting, businessHours, callTypes, messageDelivery, escalation }`. Generates all call type UUIDs internally so that `escalation.callTypeRules` keys match the `callTypes[n].id` values — the only way to pre-wire escalation rules to specific call types without a separate resolution step.

Returns a generic preset for `other` (not `null`) to avoid regressing the current behavior where `other` gets two generic call types.

#### `applyVerticalPresets(industry: Industry, currentValues: AnsweringServiceSetup): VerticalPresets | null`
Idempotency gate. Returns `null` if any downstream step is non-pristine (first-touch-only rule).

**Sentinel conditions (all must be true to be considered pristine):**
- `greeting.template === ''`
- `callTypes.length === 0`
- `businessHours.type === '24_7' && !businessHours.customHours`
- `messageDelivery.globalDefaults.channels` is exactly `['email']`, `urgentSmsEnabled === false`, and `emailAddress` is empty/undefined
- `escalation.enabled === false`

If all five are true, returns `getVerticalPresets(industry)`. Otherwise returns `null`.

**Note on `home_services`:** The home_services preset leaves `businessHours.type` as `'24_7'` (the same as the pristine default). This means the businessHours sentinel does not distinguish pre-populated from pristine state for that vertical. The `greeting.template !== ''` and `callTypes.length > 0` sentinels carry the idempotency signal for home_services — any non-empty template value satisfies the sentinel; the value does not need to be distinctive to a particular vertical.

#### Call type `timeConditions` convention

Call types marked `(always)` in the vertical defaults tables populate only `{ always: { action } }` in `timeConditions`; the `businessHours` and `afterHours` keys are omitted. Call types with separate business hours / after hours rows populate `{ businessHours: { action }, afterHours: { action } }` with no `always` key. This matches the convention already established in the existing `getIndustryPresets()` code.

### Modified: `SetupWizardClient.tsx`

In `handleNext`, after step 0 validates successfully, before `setCurrentStep`:

```typescript
if (currentStep === 0) {
  const industry = methods.getValues('profile.industry')
  const presets = applyVerticalPresets(industry, methods.getValues())
  if (presets) {
    methods.setValue('greeting', presets.greeting)
    methods.setValue('businessHours', presets.businessHours)
    methods.setValue('callTypes', presets.callTypes)
    methods.setValue('messageDelivery', presets.messageDelivery)
    methods.setValue('escalation', presets.escalation)
    toast({
      title: 'Defaults pre-filled',
      description: 'We\'ve applied industry defaults — customize them as you go.',
    })
  }
}
```

The existing debounced session watcher captures these `setValue` calls automatically — no explicit session write needed.

### Modified: `GreetingScriptStep.tsx`

- Delete `LEGAL_TEMPLATES`, `MEDICAL_TEMPLATES` constants
- Delete the `availableTemplates` `useMemo` logic that manually splices industry templates
- Import `getIndustryGreetingTemplates` from `verticalPresets.ts`
- Replace with: `const availableTemplates = getIndustryGreetingTemplates(profileIndustry)`
- No other changes — dropdown, preview, and custom script input are untouched

### Modified: `CallTypesStep.tsx`

- Delete `getIndustryPresets()` function
- Delete `hasPrePopulated` ref and its `useEffect`
- Delete `useToast` import and `toast` usage (now owned by wizard shell)
- `getIndustryLabel()` stays — still used by the `industryExamples` helper text rendered in the component description
- `industryExamples` `useMemo` stays — it renders per-industry example text in the UI and is unrelated to pre-population
- Card list, editor modal, add/delete handlers untouched

---

## Vertical Defaults

### Greeting templates (new in `verticalPresets.ts`)

| Industry | Template ID | Template text | presentAs |
|---|---|---|---|
| legal | `legal-1` | "Law offices of {business_name}. How may I direct your call?" | employee |
| medical | `medical-1` | "{business_name}. Is this regarding an appointment or a medical concern?" | employee |
| home_services | `template-1` | "Thank you for calling {business_name}. How may I help you?" | employee |
| real_estate | `real_estate-1` | "{business_name}. Are you calling about a property for sale or an existing transaction?" | employee |
| professional_services | `template-2` | "Good [morning/afternoon], {business_name}. How may I direct your call?" | answering_service |
| other | `template-1` | "Thank you for calling {business_name}. How may I help you?" | employee |

`real_estate-1` is a new template that does not exist in the codebase today. All other IDs match existing constants. Template IDs are canonical — must match exactly what is written into `greeting.template` by `getVerticalPresets`, and must appear in the list returned by `getIndustryGreetingTemplates` for that industry.

### Business hours

| Industry | type | Notes |
|---|---|---|
| legal | `standard` | Standard M–F office hours |
| medical | `custom` | M–F 8am–5pm; closed Sat–Sun; defined hours trigger after-hours on-call routing |
| home_services | `24_7` | Unchanged from pristine default; emergency services need 24/7 |
| real_estate | `standard` | Standard M–F |
| professional_services | `standard` | Standard M–F |
| other | `standard` | Changed from pristine `24_7` default |

Timezone is not pre-populated — left as the existing default (`America/New_York`) to avoid making assumptions about the user's location.

For medical, `customHours` is pre-populated: Mon–Fri `{ open: '08:00', close: '17:00', closed: false }`, Sat–Sun `{ open: '08:00', close: '17:00', closed: true }`.

### Call types

Call types marked `(always)` use only `{ always: { action } }` in `timeConditions`. All others use `{ businessHours: { action }, afterHours: { action } }`.

#### Legal
| Name | Business hours | After hours | Extra fields |
|---|---|---|---|
| New Client Inquiry | screen_and_patch | take_message | name, phone, case nature (required), opposing party for conflict check (required) |
| Existing Client | patch | patch | name, phone |
| Opposing Counsel | take_message | take_message | name, phone, firm name |
| Emergency | patch (always) | — | name, phone |

#### Medical
| Name | Business hours | After hours | Extra fields |
|---|---|---|---|
| New Patient | take_message | take_message | name, phone, date of birth |
| Existing Patient | screen_and_patch | take_message | name, phone, date of birth |
| Pharmacy/Provider | patch (always) | — | name, phone, pharmacy/provider name |
| Urgent Medical | patch (always) | — | name, phone, nature of emergency |

`Urgent Medical` is the escalation anchor — its UUID is reused in `escalation.callTypeRules`.

#### Home Services
| Name | Business hours | After hours | Extra fields |
|---|---|---|---|
| Service Request | take_message | take_message | name, phone, service address, issue description |
| Emergency Service | patch (always) | — | name, phone, service address, nature of emergency |
| Existing Customer | screen_and_patch | take_message | name, phone |

`Emergency Service` is the escalation anchor.

#### Real Estate
| Name | Business hours | After hours | Extra fields |
|---|---|---|---|
| Property Inquiry | screen_and_patch | take_message | name, phone, property of interest |
| Showing Request | take_message | take_message | name, phone, property of interest, preferred times |
| Existing Client | patch (always) | — | name, phone |
| Urgent Maintenance | patch (always) | — | name, phone, property address, issue description |

#### Professional Services
| Name | Business hours | After hours | Extra fields |
|---|---|---|---|
| New Client Inquiry | screen_and_patch | take_message | name, phone, company name, inquiry nature |
| Existing Client | patch | take_message | name, phone |
| General Inquiry | take_message (always) | — | name, phone |
| Urgent | patch (always) | — | name, phone |

#### Other (generic, prevents regression)
| Name | Condition | Extra fields |
|---|---|---|
| General Inquiry | always take_message | name, phone |
| Urgent | always patch | name, phone |

### Message delivery

| Industry | channels | urgentSmsEnabled |
|---|---|---|
| legal | email | false |
| medical | email, sms | **true** |
| home_services | email, sms | **true** |
| real_estate | email | false |
| professional_services | email | false |
| other | email | false |

### Escalation rules

| Industry | enabled | Rule |
|---|---|---|
| legal | false | — |
| medical | **true** | Urgent Medical call type: canEscalate=true, criteria="Patient reports emergency symptoms", timeCondition=24_hours |
| home_services | **true** | Emergency Service call type: canEscalate=true, criteria="Property damage or safety emergency", timeCondition=24_hours |
| real_estate | false | — |
| professional_services | false | — |
| other | false | — |

`globalEscalationContact` is intentionally left empty for medical and home_services — the user must supply their on-call number. This means the schema's `.refine()` validator will block Step 5 navigation until `globalEscalationContact` is filled in. This is the intended UX: the pre-filled escalation preset draws the user's attention to the step and makes clear what's needed, rather than silently leaving it disabled. No escape hatch or skip mechanism is needed.

---

## Idempotency

**First-touch-only rule (Option A):** Pre-population fires at most once per session. Detection is purely sentinel-field-based — no separate flag stored. If a user goes back to Step 0 and changes their industry after pre-population has already fired, the downstream steps will be non-pristine and the sentinel will return `null`.

If a user clears all their data back to pristine defaults (unlikely), the sentinel would pass again on the next Step 0 → Step 1 transition. This edge case is acceptable.

**Known gap — returning sessions with empty call types:** Pre-population fires only on the forward Step 0 → Step 1 transition in `handleNext`. If a user's session was persisted before this feature shipped (i.e., `currentStep >= 1` but `callTypes: []`), the wizard will restore at their saved step and the pre-population trigger will not fire. These legacy sessions are out of scope; affected users can manually add call types. For sessions created after this feature ships, pre-population fires in `handleNext` before the step is incremented, so the session will always be persisted with non-empty call types by the time `currentStep` reaches 3.

---

## Testing

**File:** `__tests__/lib/services/answering-service/verticalPresets.test.ts`

All tests are synchronous pure-function tests with no mocks needed.

### `isPristine()` (tested via `applyVerticalPresets`)
- All-defaults form values → pristine (presets returned)
- `callTypes.length > 0` → not pristine (null returned)
- `greeting.template !== ''` → not pristine (null returned)
- `businessHours.type !== '24_7'` → not pristine (null returned)
- `escalation.enabled === true` → not pristine (null returned)
- `messageDelivery.globalDefaults.emailAddress` non-empty → not pristine (null returned)

### `getVerticalPresets(industry)`
For each of the six industries:
- Returns object with all five step keys (`greeting`, `businessHours`, `callTypes`, `messageDelivery`, `escalation`)
- Auto-selected `greeting.template` ID exists in `getIndustryGreetingTemplates(industry)` list (ID-coupling guard)

For medical and home_services additionally:
- Each key in `escalation.callTypeRules` matches a `callTypes[n].id` value (UUID-linkage guard)

### `applyVerticalPresets(industry, currentValues)`
- Pristine values + valid industry → returns preset object
- Any non-pristine sentinel → returns null
- `other` + pristine → returns generic preset (not null — regression guard)

### `getIndustryGreetingTemplates(industry)`
- Last entry is always `{ id: 'custom', text: 'Custom' }` for all six industries

**Total: ~25 `it()` cases, all synchronous, one file.**

---

## Out of scope

- New DB tables or columns — this is entirely client-side form pre-population
- Step 0 (profile) and Step 6 (billing confirm) — not pre-populated
- Operator-facing configuration of vertical defaults — hardcoded in this sprint
- Re-population prompt if user changes industry after first touch
