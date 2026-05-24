# The Collective Savers™ — Product Requirements Document

## Original Problem Statement
The Collective Savers™ is a real-time demand aggregation platform powered by VPPs (Value Party Power Systems) that converts collective consumer intent into activated purchasing events with locked pricing, optimised payment routing, and supplier batch fulfilment.

## Architecture
- **Frontend**: React 19 + Tailwind + Shadcn UI + Phosphor Icons + react-fast-marquee + react-confetti + Sonner toasts
- **Backend**: FastAPI + Motor (MongoDB async)
- **Real-time**: Native FastAPI WebSockets (`/api/ws/feed`, `/api/ws/vpp/{id}`)
- **Payments**: Stripe Checkout (real, test mode) for card; Mocked endpoints for Open Banking & Bank Transfer (per user spec)
- **Auth**: Emergent-managed Google OAuth (httpOnly cookie + Bearer fallback)

## User Personas
- **Consumer** — joins Parties, pays at lock, sees savings
- **Supplier** — sees batch orders, dispatches
- **Admin** — creates VPPs, monitors stats, force-controls state

## VPP State Machine
`seed → active → locked → executing → completed`
(For MVP, threshold trigger auto-jumps active→locked, skipping a visible "powered" stage.)

## Core Features — V1 (Implemented 2026-05-24)
- [x] Landing page with hero, signature Live Party Card, How-It-Works, payment optimisation table, live snapshot, CTA
- [x] Browse parties with state/category/search filters; live updates via WebSocket
- [x] VPP detail page with live progress, countdown, recent joiners, join flow, confetti on POWER
- [x] Checkout with 3 payment methods: Stripe (real card), Open Banking (mocked, 3% discount), Bank Transfer (mocked, 2% discount)
- [x] Stripe Checkout session creation + polling + webhook
- [x] Consumer dashboard "My Parties" with total savings widget
- [x] Supplier dashboard with batch orders + dispatch action
- [x] Admin Control Room: stats, full VPP table, create form, force-state, delete
- [x] Emergent Google Auth: signin redirect, callback handler, /auth/me, logout, role switcher
- [x] Auto-seeded 6 VPPs on startup (Tyres + Electronics)
- [x] WebSocket real-time broadcast on join, state change, VPP creation

## Backlog (P1)
- Email/SMS notifications when Party powers
- Save card / saved payment methods
- Referral programme
- Multi-language (UK-first)
- Map view: regional VPPs (Phase 2)
- Supplier onboarding / API
- Demand forecasting analytics (Phase 4)

## Known Constraints
- `sk_test_emergent` is Emergent's shared Stripe sandbox; checkout session retrieval may be limited
- "Powered" state visible only briefly (auto-locks for MVP)
- Mocked Open Banking / Bank Transfer (production would integrate TrueLayer / Plaid + UK Faster Payments)
