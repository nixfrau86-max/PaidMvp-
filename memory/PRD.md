# The Collective Savers™ — PRD

## Problem
Build a real-time demand aggregation platform that turns fragmented consumer intent into **Waves** (collective buying events) with locked pricing, optimised payment rails, and supplier batch fulfilment.

## Personas
- **Member (consumer)** — browses & joins Waves, pre-authorises payment, books a fitter post-lock.
- **Supplier** — distributors/manufacturers fulfilling Waves in bulk.
- **Garage / Fitter** — verified place-of-business that receives tyre orders + member bookings.
- **Admin** — platform operator (allowlist via `ADMIN_EMAILS`).

## Core requirements (locked)
1. Waitlist-first landing page; no public pricing.
2. Three persona login chooser (Consumer / Supplier / Garage), 3 auth methods (Google, Email+Password, SMS OTP).
3. Wave lifecycle: SEED → ACTIVE → POWERED → LOCKED → EXECUTING → COMPLETED. Real-time over WebSockets.
4. Tyres must ship to a **verified garage**, never a private address.
5. Member books fitting **after the Wave locks** (not at checkout).
6. Checkout shows **6 lines** (configurable fee engine): Retail Price → Wave Price → Platform Service Fee → Payment Method Fee → Final Total → You Save. Commission is hidden from consumers.
7. Payment methods (admin-configurable fees + recommended flag + on/off): Open Banking (+£1, recommended), Apple Pay (+£3), Google Pay (+£3), Card (+£3), Bank Transfer (+£1.50). Wallet rails route through Stripe; OB/Bank Transfer mocked until TrueLayer/Faster Payments are wired.
8. Admin role is restricted to `ADMIN_EMAILS` env allowlist.

## What's implemented (current session — 2026-05-27)
- **Configurable fee engine** (`platform_config` collection, `GET /api/checkout/quote/{vpp_id}`, `GET/PUT /api/admin/fees`).
- Admin **Fees & Payments** tab — edit commission %, flat/percent service-fee mode, per-method fees, enable/disable, recommended flag.
- Checkout rebuilt around live quote API: 6-line summary, live recompute on method switch, Open Banking flagged "Recommended — maximise savings".
- Apple Pay + Google Pay added (both via Stripe Checkout wallet auto-detect).
- Full breakdown persisted on `payment_transactions` and `vpp_participants` (retail, wave_price, service_fee, payment_fee, final_total, total_savings, commission).
- Backend: FastAPI + Motor (MongoDB). Routes for auth (Google/Email/SMS), VPPs, checkout, supplier apply/console, garage apply/console, admin, garage availability + bookings + iCal feed.
- Founder admin seed on startup: `founder@thecollectivesavers.co.uk` / `SaversCollective`.
- Admin allowlist enforcement (`ADMIN_EMAILS`).
- Frontend: Landing (waitlist), Login (3 personas × 3 methods), Browse, VPP detail, Checkout (new fee engine), My Waves, BookFitter, Supplier console, Garage console, Admin console.
- ARCHITECTURE.md created — living ADR log.
- Testing: iteration_4 — 15/15 backend + frontend pass.

## Backlog
- P0 — T&Cs upload (recommended path: static markdown pages now → versioned acceptance log + audit pre-launch).
- P0 — Wire real Twilio creds (currently DEV-mode OTP in backend logs).
- P0 — Trigger email on Wave LOCK with "Book your fitter" link (currently surfaced only in /dashboard).
- P1 — Resend/SendGrid for supplier-approved, wave-locked, booking-confirmed emails.
- P1 — Apple Sign-In once Apple Developer Program access is in place.
- P1 — Refactor `server.py` (2,400+ LOC) into `routes/` modules before more features.
- P2 — Real Open Banking (TrueLayer / Plaid) + Faster Payments settlement.
- P2 — Stripe Connect for supplier split payouts (commission already captured in breakdown).
- P2 — Refer-a-driver growth loop.
- P2 — Demand intelligence / analytics surface.

## Tech stack
React 19 + Tailwind + Phosphor icons · FastAPI + Motor + WebSockets · MongoDB · Stripe (test) · Twilio (dev-mode).
