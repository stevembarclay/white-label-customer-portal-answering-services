# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] — 2026-03-22

### Changed — UI redesign across all 18 screens

Complete visual overhaul of the client portal and operator admin. No API or data-layer changes.

**Design system**
- Dark sidebar (`#0f172a`) replaces the previous light navigation across both portals
- Manrope font adopted throughout (headings and body)
- Lucide icons replace Phosphor Icons in the desktop sidebar navigation
- Semantic Tailwind tokens (`bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `bg-primary`) used consistently
- Unified card pattern: `rounded-xl border border-border bg-card overflow-hidden` with 52 px header rows

**Client portal**
- Login: two-panel split layout with dark marketing panel on the left, sign-in card on the right
- Forgot password / Reset password / Magic-link-sent: centred single-column card flows
- Dashboard: priority message strip + billing estimate and call volume stat cards
- Messages: search in the top bar, All / Unread / Priority tab filter, colour-coded priority badges
- On-Call: weekly grid schedule with Current Coverage status card, Shifts and Contacts list tabs
- Billing: estimated total card with days-remaining sub-text, invoice history rows
- Settings: API key manager with label input, key listing, and per-key Revoke action
- Setup wizard: 6-step progress indicator with inline Setup Assistant chat panel

**Operator admin**
- Sidebar: purple `OP` logo badge replacing the previous plain nav
- Clients: table with health-score indicator, All / At risk / Inactive filter tabs, search
- Usage: CSV drag-and-drop dropzone, call log upload, upload history table
- Billing Templates: empty-state with inline create prompt and top-bar "+ New Template" button
- API & Webhooks: operator API key manager (scopes, create, list) + webhook subscription builder
- Settings: Portal Configuration table (portal name, slug, default brand colour)

### Added

- `tests/e2e/visual-qa.e2e.ts` — Playwright screenshot suite covering all 15 routes (auth, client, operator) with console-error collection

---

## [0.1.0] — 2026-03-11

### Added

- Initial open-source release
- Client portal: 6-step onboarding wizard with AI Setup Assistant (GPT-4o-mini)
- Client portal: Dashboard, Messages, On-Call scheduling, Billing, Settings, Account Setup
- Operator admin: Clients table, Usage CSV upload, Billing Templates, API keys & Webhooks, Settings
- Public API: `GET /api/v1/on-call/current` with bearer-token auth and `on_call:read` scope
- Supabase Auth — email/password, magic link, password reset; no public sign-up
- Multi-tenant RLS: all data scoped to `business_id` at both application and database layers
- `STANDALONE_MODE=true` env var to bypass per-module DB check for self-hosted deployments
- Seed script creating demo business (Riverside Law Group) with 3 months of call and billing history
- E2E test suite: 28 Playwright tests covering auth flows, client portal, and operator admin

[1.1.0]: https://github.com/stevembarclay/white-label-customer-portal-answering-services/compare/v0.1.0...v1.1.0
[0.1.0]: https://github.com/stevembarclay/white-label-customer-portal-answering-services/releases/tag/v0.1.0
