# Answering Service Module

**Last Updated:** 2026-03-22
**Version:** 1.1.0
**Status:** ✅ Active

---

## Overview

Customer-facing portal and onboarding wizard for Answering Service customers. This module provides a complete onboarding experience with a 6-step guided configuration wizard, dashboard, billing management, on-call scheduling, and message/call log viewing — all behind a dark-sidebar design system.

See the README for integration status (connecting a live telephony or billing provider).

---

## Components

### Onboarding Wizard (`/answering-service/setup`)

**Location:** `app/(platform)/answering-service/setup/`, `components/answering-service/`

**Purpose:** 6-step guided configuration for new customers

**Steps:**
1. **Profile** - Business info, industry, contact details
2. **Greeting Script** - What callers hear when they call
3. **Business Hours** - Timezone, schedule, after-hours configuration
4. **Call Types** - Industry-specific call handling rules
5. **Message Delivery** - Notification preferences per call type
6. **Escalation Rules** - Emergency criteria and contacts

**Key Files:**
- `SetupWizardClient.tsx` - Main wizard orchestrator with state management
- `components/answering-service/steps/*.tsx` - Individual step components:
  - `ProfileStep.tsx`
  - `GreetingScriptStep.tsx`
  - `BusinessHoursStep.tsx`
  - `CallTypesStep.tsx` - Includes `CallTypeCard.tsx`, `CallTypeEditor.tsx`, `CallHandlingConfig.tsx`
  - `MessageDeliveryStep.tsx`
  - `EscalationRulesStep.tsx`
- `WizardProgress.tsx` - Progress indicator
- `PathSelector.tsx` - Self-serve vs. concierge path selection
- `BuildSpecOutput.tsx` - Mermaid diagram output of build spec
- `OnboardingBooking.tsx` - Cal.com integration for concierge booking
- `schemas/answeringServiceSchema.ts` - Zod validation schemas
- `lib/services/answering-service/wizardService.ts` - Database persistence

**Database:** `answering_service_wizard_sessions` table (Supabase)
- Stores session state, current step, form data (JSONB)
- Tracks build status: `pending_build`, `in_review`, `ready`, `call_scheduled`
- Session tracking for abandonment analytics

**Features:**
- Industry pre-population (Legal, Medical, Home Services, Real Estate, Professional Services)
- LLM-powered contextual coach (`/api/answering-service/coach`)
- Cal.com integration for concierge booking
- Build spec output with Mermaid diagrams
- Session tracking for abandonment analytics
- Auto-save wizard progress
- Resume functionality from any step

### Customer Dashboard (`/answering-service/dashboard`)

**Location:** `app/(platform)/answering-service/dashboard/`, `billing/`, `messages/`

**Tabs:**
- **Dashboard**: Summary cards (calls, balance, payment), recent activity
- **Billing**: Invoice list with detail modal, PHI masking
- **Messages**: Split view (call list + transcript), search/filter, PHI masking

**Key Files:**
- `AnsweringServiceDashboardClient.tsx` - Main dashboard client component (export: AnsweringServiceDashboardClient)
- `DashboardSummaryCard.tsx` - Summary metrics cards
- `RecentActivityFeed.tsx` - Activity timeline
- `BillingClient.tsx`, `InvoiceDetailModal.tsx` - Billing management
- `MessagesClient.tsx`, `MessageList.tsx`, `MessageTranscript.tsx` - Message viewing
- `lib/services/answering-service/mock*.ts` - Mock data services
- `DashboardHelper.tsx`, `DashboardCoachChat.tsx` - Account support AI
- `CallRating.tsx` - 5-star rating with feedback flow

**Features:**
- Demo mode banner (sample data indicator)
- Onboarding status banner (`OnboardingBanner.tsx`)
- Clickable summary cards
- Dashboard AI Helper (`DashboardHelper.tsx`, `/api/answering-service/dashboard-coach`)
- Call rating system (`CallRating.tsx`) - 5-star with feedback flow
- PHI masking toggle (`PHIToggleDemo.tsx`)
- Audit log badges (`AuditLogBadgeDemo.tsx`)

### Shared Components

**Location:** `components/answering-service/`

- `CoachPanel.tsx`, `CoachChat.tsx` - Onboarding AI coach
- `DashboardHelper.tsx`, `DashboardCoachChat.tsx` - Account support AI
- `OnboardingBanner.tsx` - Status banner across tabs
- `DemoModeBanner.tsx` - Sample data indicator
- `CallRating.tsx` - Star rating with conditional follow-up
- `PHIToggleDemo.tsx` - HIPAA compliance UI (demo)
- `AuditLogBadgeDemo.tsx` - Audit logging UI (demo)

---

## API Routes

**Location:** `app/api/answering-service/`

- `POST /api/answering-service/coach` - Onboarding wizard coach
  - Provides contextual help during wizard steps
  - Uses conversation history and wizard context
  - Rate limited: 10 requests/minute per business

- `POST /api/answering-service/dashboard-coach` - Account support helper
  - Provides account-level support in dashboard
  - Mode: `account_support`
  - Rate limited: 10 requests/minute per business

- `POST /api/answering-service/wizard/save` - Persist wizard progress
  - Auto-save functionality
  - Updates session state and form data

- `GET /api/answering-service/wizard/session` - Retrieve session
  - Fetches existing wizard session for resume

---

## Database Schema

**Migration:** `migrations/20260108125310_create_wizard_sessions.sql`

```sql
CREATE TABLE answering_service_wizard_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  current_step INTEGER NOT NULL DEFAULT 0,
  wizard_data JSONB DEFAULT '{}'::jsonb,
  path_selected TEXT CHECK (path_selected IN ('self_serve', 'concierge')),
  status TEXT NOT NULL DEFAULT 'in_progress' 
    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  build_status TEXT CHECK (build_status IN ('pending_build', 'in_review', 'ready', 'call_scheduled')),
  started_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  completed_at TIMESTAMPTZ
);
```

**Indexes:**
- `business_id`, `user_id`, `status`
- `(business_id, status)` - Composite index
- `updated_at` - For session cleanup queries

**RLS Policies:**
- Users can only access sessions for businesses they belong to
- Policies use `users_businesses` join pattern for multi-tenant isolation

---

## Service Layer

**Location:** `lib/services/answering-service/`

### WizardService

**File:** `lib/services/answering-service/wizardService.ts`

**Methods:**
- `getOrCreateSession(businessId, userId)` - Gets or creates wizard session
- `updateSession(sessionId, params, businessId)` - Updates session state
- `completeSession(sessionId, businessId)` - Marks session as completed
- `abandonSession(sessionId, businessId)` - Marks session as abandoned

**Error Handling:**
- Custom `WizardServiceError` class
- Proper validation using Zod schemas
- All queries scoped by `business_id` for security

---

## Schema Validation

**Location:** `schemas/answeringServiceSchema.ts`

**Zod Schemas:**
- `profileSchema` - Business profile validation
- `greetingSchema` - Greeting script validation
- `businessHoursSchema` - Business hours validation
- `callTypesSchema` - Call types array validation
- `messageDeliverySchema` - Message delivery configuration
- `escalationSchema` - Escalation rules validation
- `answeringServiceSetupSchema` - Complete setup configuration

**Type Exports:**
- `AnsweringServiceSetup` - Complete setup type
- Individual step types: `Profile`, `Greeting`, `BusinessHours`, etc.

---

## Demo User

- **Email:** `demo@example.com` (configure in `scripts/seed-demo.ts`)
- **Access:** Answering Service module only (sidebar filtered by email check)

---

## Integration Points (Future)

### billing provider (Billing)
- Invoice data integration
- Payment status synchronization
- Billing history retrieval

### telephony provider (Call/Messages)
- Call log integration
- Transcript retrieval
- Message status updates

### HIPAA Compliance
- PHI masking boundaries documented in implementation
- Audit logging requirements
- Data access controls

---

## Features Summary

### Implemented ✅
- 6-step onboarding wizard with auto-save
- Session persistence and resume functionality
- Industry-specific pre-population
- AI-powered onboarding coach
- Dashboard with summary metrics
- Billing invoice viewing (mock data)
- Message/call log viewing (mock data)
- Call rating system
- PHI masking UI (demo)
- Cal.com integration for concierge booking
- Build spec output with Mermaid diagrams

### Future Enhancements ⏳
- Real billing provider API integration
- Real telephony provider API integration
- Production HIPAA compliance
- Webhook handlers for real-time updates
- Multi-user access per business

---

## File Structure

```
app/(platform)/answering-service/
├── page.tsx                          # Redirect
├── setup/
│   └── page.tsx                      # Setup wizard page
├── dashboard/
│   ├── page.tsx                      # Dashboard page
│   └── AnsweringServiceDashboardClient.tsx # Dashboard client
├── billing/
│   ├── page.tsx                      # Billing page
│   └── BillingClient.tsx             # Billing client
└── messages/
    ├── page.tsx                      # Messages page
    └── MessagesClient.tsx            # Messages client

components/answering-service/
├── SetupWizardClient.tsx             # Main wizard orchestrator
├── WizardProgress.tsx                # Progress indicator
├── PathSelector.tsx                  # Path selection
├── OnboardingBooking.tsx             # Cal.com booking
├── BuildSpecOutput.tsx               # Mermaid output
├── CoachPanel.tsx                    # Onboarding coach UI
├── CoachChat.tsx                     # Coach chat component
├── DashboardHelper.tsx               # Dashboard helper UI
├── DashboardCoachChat.tsx            # Dashboard coach chat
├── OnboardingBanner.tsx              # Onboarding status banner
├── DemoModeBanner.tsx                # Demo mode indicator
├── CallRating.tsx                    # Call rating component
├── steps/
│   ├── ProfileStep.tsx
│   ├── GreetingScriptStep.tsx
│   ├── BusinessHoursStep.tsx
│   ├── CallTypesStep.tsx
│   ├── CallTypeCard.tsx
│   ├── CallTypeEditor.tsx
│   ├── CallHandlingConfig.tsx
│   ├── MessageDeliveryStep.tsx
│   └── EscalationRulesStep.tsx
└── [other shared components]

app/api/answering-service/
├── coach/route.ts                    # Onboarding coach API
├── dashboard-coach/route.ts          # Dashboard coach API
└── wizard/
    ├── save/route.ts                 # Save wizard progress
    └── session/route.ts              # Get wizard session

lib/services/answering-service/
├── wizardService.ts                  # Wizard persistence service
└── [mock services for demo data]

schemas/
└── answeringServiceSchema.ts        # Zod validation schemas

types/
└── answeringService.ts              # TypeScript types

migrations/
└── 20260108125310_create_wizard_sessions.sql
```

---

**Last Updated:** 2026-03-22


