# Answering Service POC Module

**Last Updated**: 2026-01-05  
**Status**: POC Complete  
**Type**: ⚠️ **Proof of Concept**

---

## Overview

The Answering Service module is a **high-fidelity vertical slice Proof of Concept (POC)** for an answering service customer portal. This module demonstrates integration capabilities with billing provider (billing) and telephony provider (call logs/transcripts).

**⚠️ IMPORTANT**: This is a POC — not production-ready. All data is mock/simulated.

---

## Purpose

This POC was built as a sales demonstration to showcase:
- Customer portal capabilities
- Integration readiness (billing provider, telephony provider)
- HIPAA compliance UI elements
- Modern, responsive design

---

## Module Details

### Routes

- `/answering-service/dashboard` - Customer dashboard with summary cards
- `/answering-service/billing` - Invoice management (mock billing provider integration)
- `/answering-service/messages` - Call logs and transcripts (mock telephony provider integration)

### Features

1. **Dashboard**:
   - Calls this week summary
   - Current balance and payment due date
   - Recent activity feed (calls and invoices)

2. **Billing**:
   - Invoice table with status badges
   - PHI toggle for sensitive data masking
   - "View Invoice" action (mock)

3. **Messages**:
   - Call log list with status indicators
   - Transcript viewer with speaker segmentation
   - PHI toggle for masking sensitive information

### Technical Implementation

- **Data**: All data is mock/simulated (no backend persistence)
- **Async Simulation**: ~800ms delays to demonstrate loading states
- **HIPAA Components**: Demo-only UI components (non-functional)
- **Theme**: Dark theme (shadcn/ui)
- **Components**: Shadcn UI with custom styling

---

## Module Gating

This module is **tenant-gated** via the `enabled_modules` array in the `businesses` table:

```sql
-- Enable for a specific business
UPDATE businesses
SET enabled_modules = enabled_modules || '["answering_service"]'::jsonb
WHERE id = '<your-business-id>';
```

---

## What This Module Is NOT

- ❌ **Not production-ready** - it's a POC/demo
- ❌ **Not production-ready** - all data is mock
- ❌ **Not integrated** - no actual billing provider/telephony provider APIs
- ❌ **Not HIPAA compliant** - UI elements are demo-only
- ❌ **Not persistent** - no database storage
- ❌ **Not for general use** - tenant-specific POC

---

## What This Module Demonstrates

- ✅ Integration contract readiness (billing provider, telephony provider)
- ✅ Modern UI/UX
- ✅ Responsive design patterns
- ✅ Loading state patterns
- ✅ HIPAA compliance UI concepts
- ✅ Module-level multi-tenancy gating

---

## Files Structure

```
app/(platform)/answering-service/
├── dashboard/
│   ├── page.tsx
│   └── AnsweringServiceDashboardClient.tsx
├── billing/
│   ├── page.tsx
│   └── BillingClient.tsx
└── messages/
    ├── page.tsx
    └── MessagesClient.tsx

components/answering-service/
├── DashboardSummaryCard.tsx
├── RecentActivityFeed.tsx
├── BillingTable.tsx
├── MessageList.tsx
├── MessageTranscript.tsx
├── PHIToggleDemo.tsx
└── AuditLogBadgeDemo.tsx

lib/services/answering-service/
├── mockDashboardService.ts
├── mockBillingService.ts
└── mockMessageService.ts

types/
└── answeringService.ts
```

---

## Future Considerations

If this POC is successful and Answering Service becomes a customer:

1. **Backend Integration**:
   - Create API routes for billing provider/telephony provider
   - Implement webhook handlers
   - Add database persistence

2. **Production Features**:
   - Real HIPAA compliance
   - Account and Support pages
   - Error handling improvements
   - Performance optimization

3. **Module Evolution**:
   - May become a reusable "Customer Portal" module
   - Could be generalized for other customers
   - Would require architectural review

---

## Maintenance Notes

- Keep this module isolated from host platform functionality
- Do not add dependencies on core modules
- Keep mock data services separate
- Document any changes that affect the POC scope

---

**Last Updated**: 2026-01-05








