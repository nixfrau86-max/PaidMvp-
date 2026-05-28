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

## What's implemented (latest — 2026-05-28b)
### Admin Users tab + T&Cs audit + Firebase Analytics (NEW, P0)
- **Admin Users tab** (`/admin` → Users): list with search (email/name/user_id), role + status filters, paginated table. Inline role select (consumer/supplier/garage/admin, admin grants gated by `ADMIN_EMAILS` env allowlist). Actions: suspend (with reason), unsuspend, soft-delete (frees email + invalidates sessions), hard-delete (irreversible, double-confirm via email retype), and Details modal showing activity stats (VPP + Tyre participations + payment_transactions). Cannot modify self / admin.
- **Admin Audit log** — every admin action (`user_update`, `user_soft_delete`, `user_hard_delete`) recorded in `admin_audit_log` with actor + target + changes + timestamp. `GET /api/admin/audit-log` returns the latest 500.
- **Suspension is enforced at the gate**: `get_current_user()` rejects suspended (403) + deleted (403) accounts; `/api/auth/login` returns 403 before issuing a session for suspended users. All active sessions are purged on suspend/delete via `db.user_sessions.delete_many`.
- **T&Cs static pages**: `/terms` and `/privacy` (versioned v1.0, effective 2026-05-28). Linked from Landing footer + AdminPanel `T&Cs Audit` tab + footer of all key pages.
- **T&Cs acceptance audit**: tick-boxes on **Tyre Wave Join** (gates Join button until checked) and **Supplier Onboarding** (gates apply). Each acceptance recorded in `terms_acceptances` with `{user_id, doc_id, version, is_current, context, ip, user_agent, accepted_at}`. Admin can filter audit by doc / user.
- **New backend endpoints**: `GET /api/terms/docs`, `POST /api/terms/accept`, `GET /api/terms/me`, `GET /api/admin/terms/audit`, `GET/PATCH/DELETE /api/admin/users[/:id]`, `GET /api/admin/audit-log`.
- **Firebase Analytics**: Firebase Web SDK initialised from `REACT_APP_FIREBASE_*` env vars (project `the-collective-savers-paid-mvp`, measurementId `G-CES43X2L3W`). `track('page_view')` on every route change, `track('tyre_wave_join')` on Wave join, `identify(user)` on login/logout. Silent no-op if not enabled.
- **Iteration_6 testing**: 20/20 backend pytest pass. Initial frontend bug (UsersTab + TermsAuditTab mounts missing) FIXED + redeployed. `db.sessions` → `db.user_sessions` collection bug also fixed.

### Supplier category multi-select + tyre gating (2026-05-28a)
- Supplier model now stores `categories: List[str]` (multi-select) alongside back-compat `category`. `_serialize_supplier` returns `is_tyre_supplier: bool` for frontend gating.
- Supplier onboarding form replaced the single-category dropdown with **tick-box cards** (Tyres / Automotive / Electronics / Home & Garden / Consumer Goods / Services / Other). "Tyres" tile carries an "Auto Engine" badge.
- `/supplier/onboarding` now also serves EXISTING suppliers — pre-fills form + PATCHes `/suppliers/me` so anyone can add Tyres later without re-applying.
- All `/api/supplier/product-groups/*` endpoints now require `_require_tyre_supplier()` — returns 403 with a helpful "tick the Tyres box" message for non-tyre suppliers.
- `SupplierDashboard` only shows the "Tyre Product Groups" CTA when `supplier.is_tyre_supplier` is true; renders category chips below the business name.
- `SupplierProductGroups` page detects 403 and renders a friendly "Restricted Section" gate with a deep link to onboarding to add Tyres.
- Public/landing Navbar no longer surfaces "Tyre Waves" link (admin-only now); deep link `/tyres` still works.

### Tyre Product Group Waves© — Auto Wave Engine (P0)
Suppliers **no longer manually create tyre Waves**. They upload Product Groups; the platform manages the Wave lifecycle, threshold tracking, inventory allocation and live participation in real-time.
- Collections: `product_groups`, `tyre_sizes`, `tyre_waves`, `tyre_participations`.
- Supplier endpoints: `POST/GET /api/supplier/product-groups`, `GET/PATCH /api/supplier/product-groups/{id}`, `PUT /api/supplier/product-groups/{id}/sizes` (upsert / overwrite), `DELETE …/sizes/{size_id}`, `POST …/csv-import`, `POST /api/supplier/product-groups/api-sync` (idempotent API feed).
- Public consumer endpoints: `GET /api/tyre/waves` (with `?size=` and `?q=`), `GET /api/tyre/sizes`, `GET /api/tyre/waves/{id}` (supplier identity hidden, supplier_price stripped), `POST /api/tyre/waves/{id}/join` (idempotent, validates size + stock), `GET /api/me/tyre-waves`.
- WebSockets: `/api/ws/tyrewaves` (global feed), `/api/ws/tyrewave/{wave_id}` (per-wave live counter with pulse animation).
- Auto-lock: once `participants_count >= target_count`, wave state transitions to `locked` and broadcasts to subscribers.
- CSV import: tolerant column names, row-level errors returned without aborting the batch.
- Privacy: estimated savings band (15–25%) shown pre-lock; final collective price revealed only at checkout post-lock.
- Frontend: `/tyres` (search by size or brand → premium wave card grid), `/tyre-wave/:id` (hero + size tiles + sticky wave-progress card + Join CTA with anonymous redirect-to-login), `/supplier/product-groups` (list + create modal + CSV import modal + per-PG detail with inventory table).
- Auto-seed at startup with 3 product groups (Michelin CrossClimate 2, Continental PremiumContact 7, Pirelli P Zero PZ4) for instant demo.
- Manual VPP/Wave flow preserved for non-tyre categories (hybrid system).
- Testing: iteration_5 — 23/23 backend + critical frontend paths pass.

## What's implemented (previous — 2026-05-27)
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
