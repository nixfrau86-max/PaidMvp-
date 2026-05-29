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

## What's implemented (latest — 2026-05-29)
### 🌊 Regional Product Waves© — Architecture Pivot (Phase 1 + 2, NEW)
The platform pivoted from the tyre-only auto-engine to a generalized **Regional Product Waves©** system. Core principle: **ONE WAVE = ONE REGION + ONE CATEGORY + ONE UNIT TARGET**.
- **Categories**: tyres · electronics · footwear (extensible). `GET /api/wave-categories`.
- **Regions** (admin-managed, seeded local: Warwickshire, Coventry, Leamington Spa, Rugby, Midlands): `GET /api/regions`, `POST/PATCH/DELETE /api/admin/regions`.
- **Suppliers create waves directly** (retiring the product-group auto-engine): region + category + brand + product models + variants (label, supplier_cost, retail_price, wave_price, inventory_qty) + ideal_target + min_activation + ETA. CRUD at `/api/supplier/waves[/{id}]`, `+/order-summary`. Edit + remove supported (remove releases reservations; blocked if captured payments exist). Manager UI at `/supplier/waves` (`SupplierWaves.jsx`).
- **Consumers** browse at `/waves` (`WaveBrowse.jsx`, filter by category/region/search) and join at `/wave/:id` (`WaveDetail.jsx`): pick product → variant → quantity → garage (tyres) or delivery address (electronics) → accept terms → Join. `GET /api/waves`, `GET /api/waves/{id}`, `POST /api/waves/{id}/join`, `GET/DELETE /api/me/wave-orders[/{id}]`.
- **Wave states**: `open → almost_full (≥80% capacity) → activated (≥min_activation units) → processing → fulfilment → completed` (or `expired`). Auto-activation on join via `_recompute`.
- **Inventory reservation**: join reserves variant stock (reserved_qty), 25-min `reservation_expires_at` stamped (enforcement/sweeper deferred to Phase 3 Stripe). Cancel releases stock + recomputes.
- **Privacy**: public `_public_wave` strips `supplier_id` (wave) + `supplier_cost` (variant). Verified by test.
- **Real-time**: WS `/api/ws/wave/{id}` (per-wave) + `/api/ws/waves` (feed) broadcast `units_committed/participants_count/state/progress_pct`.
- **Admin oversight**: `/admin` → **Regional Waves** tab (`RegionalWavesTab.jsx`) — regions manager + all-waves table with state dropdown + delete. `GET /api/admin/regional-waves`, `PATCH …/{id}/state`, `DELETE …/{id}`.
- **Backend module**: `/app/backend/routes/waves.py` (build_router DI). Seeds 2 demo waves on startup.

### 🛡️ Admin Supplier Management (Phase 1, NEW)
- `/admin` → Suppliers tab now shows **account_status** badge + **Suspend / Unsuspend / Soft-delete / Hard-delete** actions (mirrors Users tab). `routes/admin_suppliers.py`: `GET /api/admin/suppliers/{id}/detail`, `PATCH /api/admin/suppliers/{id}/account`, `DELETE /api/admin/suppliers/{id}[?hard=true]`.
- Suspend propagates to the linked user (status + session purge); refuses to touch admin-owned suppliers. Soft-delete demotes owner to consumer + frees supplier_id.

### Testing — iteration_8
- Backend: **27/27 pytest** (`/app/backend/tests/test_regional_waves.py`). Frontend: all flows pass, zero critical issues. 100% / 100%.

### Garage fix + fitting slots + contact email (2026-05-29c)
- **Fixed "Selected garage is not available"** — root cause: (1) zero garages were seeded; (2) `join_wave` validated `status=="verified"` but garages use the `is_verified` boolean. Fixed validation to `is_verified && is_active`. Public `GET /api/garages` now lists **only approved** (verified + active) garages so the dropdown can't offer un-joinable garages.
- **Seeded 4 approved local garages** (`seed_garages` in waves.py): Coventry Tyre Centre, Warwick Fast Fit, Leamington Garage Hub, Rugby Wheel & Tyre — verified, Mon–Fri 9–5, 30-min slots (DEFAULT_AVAILABILITY).
- **30-min fitting slot picker** added to the tyre wave join flow (`WaveDetail.jsx`): after picking a garage, members choose a 30-min slot starting **2 days out** (tyres arrive next working day). New `min_lead_days` param on `GET /api/garages/{id}/slots`. Join stores `fitting_slot_iso` + `fitting_slot_label` on the participation; Join is gated until a slot is chosen.
- **Contact email** changed to `founder@thecollectivesavers.co.uk` in Footer, Terms, Privacy.
- Verified end-to-end (curl tyre-join with garage+slot succeeds, screenshot of slot picker, 27/27 regression pass).

### Code-review fixes (2026-05-29b)
- **Array-index keys → stable keys**: `SupplierWaves.jsx` form arrays now use a client-generated `_key` (products + variants) and composite keys in the order-summary modal; index-based `data-testid`s preserved for tests. (`_key` is never sent to the backend.)
- **Empty catch blocks** logged: `Browse.jsx`, `VPPDetail.jsx`, `CheckoutSuccess.jsx`, `GarageOnboarding.jsx` now `console.warn` on failure.
- **Deferred (with rationale)**: (a) localStorage→httpOnly auth migration — sensitive auth change; must route through `integration_playbook_expert_v2` and get its own tested task (the app already issues httpOnly session cookies; localStorage is only a bearer fallback). (b) `build_router` "complexity 101" in `routes/waves.py`/`admin_users.py` — reflects the intentional DI closure pattern, not a defect. (c) Several hook-dep suggestions (`api`, `WebSocket`, `URLSearchParams`, `data`, `err`) are false positives — ESLint react-hooks passes clean; adding them would break the code. (d) Static decorative index keys (`WaveBackground.jsx`, `Landing.jsx`) left as-is (lists never reorder).

## What's implemented (previous — 2026-05-28c)
### Refactor: AdminPanel.jsx split + server.py partial routes/ extraction (NEW)
- **AdminPanel.jsx refactor** — was 887 LOC monolith, now **144 LOC** slim composer importing 7 focused tab modules from `/app/frontend/src/pages/admin/`:
  - `_shared.jsx` (Shell, Th, Td, Field, Stat, SupplierStatusBadge)
  - `CreateVPPForm.jsx`
  - `WavesTab.jsx`, `PendingWavesTab.jsx`, `SuppliersTab.jsx`
  - `UsersTab.jsx` (with UserStatusBadge + UserDetailModal as colocated helpers)
  - `TermsTab.jsx`, `FeesTab.jsx`
- **server.py routes/ scaffold** — created `/app/backend/routes/` package + `/app/backend/core.py` shared singletons (db, client, logger). Extracted ~270 LOC of admin user management + T&Cs into:
  - `routes/admin_users.py` — `/api/admin/users/*`, `/api/admin/audit-log` (uses `build_router(deps)` DI pattern to avoid circular imports)
  - `routes/terms.py` — `/api/terms/*`, `/api/admin/terms/audit`
- server.py down from **3,638 → 3,389 LOC** in this pass. Tyre PG + admin VPP + suppliers/garages/auth/checkout still inline (next pass).
- **Defence-in-depth admin auto-demotion**: any user with role=admin whose email is NOT in `ADMIN_EMAILS` env is auto-demoted to `consumer` on login + on session creation. Protects against past leaked-admin DB state.
- **Rogue admin cleanup** (2026-05-28): purged 4 test-artifact admins (`dbg@x`, `test-user-b6401dca7e`, `test-user-12a6839647`, `test-user-39a23a5eb3`) via hard-delete; demoted 3 real-looking admins (`ilonashmeish@gmail.com`, `busta@busta.com`, `nixfrau86@gmail.com`) to `consumer`. Only `founder@thecollectivesavers.co.uk` retains admin.
- **Iteration_7 testing**: 100% backend pytest (20/20) + 100% frontend admin UI navigation (all 6 tabs render, 100 user rows, action buttons present, /terms + /privacy public pages load, zero JS console errors).

### Admin Users tab + T&Cs audit + Firebase Analytics (2026-05-28b)
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
