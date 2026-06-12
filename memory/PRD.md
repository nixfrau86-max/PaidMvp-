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

## What's implemented (latest — 2026-06-12)
### 📦 Per-user annual unit limits per category (DONE)
- **Caps (admin-editable, stored in `platform_config._id=unit_limits`):** tyres **12**, electronics **5**, footwear **3**, any other category default **3** — per **calendar year**.
- **Counts** all active commitments (reserved/allocated + paid) in the current calendar year; released/cancelled/expired excluded.
- **Enforcement** in `join_wave` (`routes/waves.py`): blocks with a clear message when `used + qty > limit`. New `_units_used_this_year` helper.
- **Per-user override** ("unless requested by user"): admin sets a per-category limit on the user doc via `PATCH /admin/users/{id}` (`unit_limit_overrides`); override wins over the category default. UI in Users → user detail modal (`unit-limit-overrides`).
- **Allowance API:** `GET /api/me/unit-allowance?category=` → `{limit, used, remaining, year, override}`.
- **Admin config API:** `GET/PUT /api/admin/unit-limits`. UI: "Annual Unit Limits" card in the admin Fees tab (`unit-limits-card`).
- **Consumer UX (`WaveDetail.jsx`):** shows "Annual allowance · X of Y units left in {year}", caps the qty stepper at `min(stock, remaining)`, and disables Join with "Annual limit reached" when exhausted.
- Tests: `TestAnnualUnitLimits` (enforcement + override + allowance + admin config). Regression **39 passed**. UI verified via screenshots (allowance line, admin caps card, per-user override editor).

## What's implemented (latest — 2026-06-09)
### 🔁 Auto-respawn bugfix — respawn on demand, not only on paid sales (DONE)
- **Bug (reported):** waves weren't regenerating even though "plenty of stock was available and allocated." Root cause: the earlier correctness fix (#6) made `complete_wave_and_respawn` require **captured (paid)** units to respawn — so waves where stock was **reserved/allocated but unpaid** returned `respawned:false` and never spun up a follow-on wave.
- **Fix:** respawn now triggers on **genuine demand** — any active participation (reserved/authorized/captured) signals interest — while still counting only **paid (captured)** units as "sold" for the leftover math. Stranded reservations on the completed wave are **released**. Never-touched waves (zero demand) still don't respawn (avoids pointless clones). `complete_wave_and_respawn` in `routes/waves.py`.
- **Note:** respawns created outside working hours are **scheduled** for the next working day 08:00 (Europe/London time-guard, existing requirement) and materialised by the 60s `process_due_scheduled_waves` worker — verified it produces a live `open` wave.
- Tests: `tests/test_wave_lifecycle.py::TestRespawnOnDemand` (respawn-on-allocated-unpaid + no-respawn-without-demand). Regression **37 passed**.

## What's implemented (latest — 2026-06-09)
### 💳 Phase 3 Stripe Pay-on-activation — VERIFIED END-TO-END (DONE)
- **Root-cause fix:** `emergentintegrations` was pinned to `0.1.0`, where `StripeCheckout.get_checkout_status()` failed with `No such checkout.session` (create worked, status didn't) — payments could never settle. Upgraded to **0.2.0** (`requirements.txt`), which fixed status retrieval with the Emergent test key `STRIPE_API_KEY=sk_test_emergent`.
- **Full E2E verified** via real UI + Stripe hosted checkout (test card 4242): Pay Now → `/wave-pay/:pid` → Stripe checkout (£165.50) → success page "PAID! You're locked in." → backend settled: participation `captured`/`paid`, stock moved reserved→sold (0/2), `payment_transactions` paid, and **fitting booking auto-confirmed** (garage + slot Thu 11 Jun 09:00, status `confirmed`).
- **Mock rails verified** (Open Banking / Bank Transfer): `wave-checkout` → `mock-confirm` settles identically (captured/paid).
- Settlement is idempotent (guarded on `payment_status=="paid"`). Regression **35 passed**. Cleaned all TEST_ wave artifacts.

## What's implemented (latest — 2026-06-09)
### 🌊 Wave-logic review fixes (lifecycle correctness — DONE)
Reviewed `routes/waves.py` + `wave_payments.py` + startup workers; fixed all findings:
- **#1 Fill-to-capacity.** `activated` is now a **non-blocking latch** — a wave keeps accepting joins after hitting `min_activation`, right up to `ideal_target` (capacity). New wave-level capacity guard in `join_wave` + frontend `WaveDetail` now shows the Join form for `activated` waves (and "Fully subscribed" at capacity). Previously waves closed at `min_activation`, wasting capacity. `_recompute` moved to module-level `_recompute_wave` (reused by workers).
- **#2 `almost_full` revived** via the recompute reorder + activated_at latch.
- **#3 Reservation/payment sweeper** — new `sweep_payment_windows(db, manager, hours=48)`: releases unpaid reservations on activated waves past a 48h payment window, freeing locked stock. Wired into the 60s startup worker.
- **#4 Deadline expiry** — new `expire_overdue_waves(db, manager)`: under-filled waves past `deadline` → `expired` + reservations released. Wired into the worker.
- **#5 Atomic reservation** — `join_wave` now increments `reserved_qty` first, verifies no variant went negative, and rolls back on a concurrent-join race (returns 409). Prevents oversell.
- **#6 Respawn counts only paid units** — `complete_wave_and_respawn` now sums only `captured` participations as sold; reserved-but-unpaid units flow into the leftover respawn pool.
- **#7 Activation latch on cancellations** — once `activated_at` is stamped, state never downgrades.
- Tests: `tests/test_wave_lifecycle.py` (2, join-past-activation + capacity), workers verified directly. Regression **35 passed** (regional + respawn + lifecycle). Stale demo waves reset → fresh open seeds.

## What's implemented (latest — 2026-06-09)
### 🔒 Security hardening + complexity refactor (Code-review issues — DONE)
- **Issue 1 (P1) — Auth tokens out of localStorage → httpOnly cookie only.** Removed the axios `localStorage` bearer interceptor (`lib/api.js`), the `localStorage.setItem` in `AuthCallback.jsx`, and the `removeItem` in `auth.jsx` logout. Auth now rides entirely on the existing `session_token` httpOnly+secure+samesite=none cookie (`withCredentials`). Verified: login → `/dashboard` works, `localStorage.getItem('session_token')` is `null`, `/api/auth/me` returns 401 without the cookie. Bearer fallback kept server-side only (for curl/test agents).
  - **Bonus leak closed**: `password_hash` was being returned by `/auth/me`, `/auth/session`, `/auth/role`. Fixed at source — `_get_user_from_session_token` now projects `{"_id":0,"password_hash":0}`; `/auth/session` also pops it. Login verification unaffected (uses its own query). Playbook saved at `/app/auth_testing.md`.
- **Issue 2 (P2) — `routes/waves.py` complexity.** Extracted the stateless helpers (`_variant_available`, `_wave_units`, `_public_wave`, `_normalize_products`) and a new `_derive_fitting_label` + `_validate_join_items` out of the `build_router()` closure to module level. `join_wave` is now ~2 lines of orchestration. Behaviour identical — regression `test_regional_waves.py` + `test_wave_respawn.py` = **31 passed, 2 skipped**. (Pre-existing failures in legacy `test_tyre_waves.py`/`test_garage_calendar_sync.py` confirmed unrelated via git-stash.)

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

### Auto-respawn wave lifecycle (2026-05-29e)
- **Leftover-stock respawn**: when a wave is marked **completed**, committed units are recorded as **sold**; if any stock remains, a **follow-on wave** ("· Round N") is auto-created for the leftover inventory — repeating until stock depletes. Only respawns if the round actually sold ≥1 unit (avoids dead loops).
- **Time guard (Europe/London)**: create immediately on a working day before 16:00; otherwise schedule for the **next working day 08:00** (weekends skipped). A 60s background worker (`process_due_scheduled_waves`) materialises due `scheduled_waves`.
- Backend: `routes/waves.py` (`complete_wave_and_respawn`, `_next_creation_time_london`, `_compute_remaining_products`, `_build_respawn_doc`), hooked into `PATCH /api/admin/regional-waves/{id}/state` on `completed`. Tests: `tests/test_wave_respawn.py` (6 pass).

### Fitting logistics surfaced + account editing (2026-05-29d)
- **Member "My Waves" (`/dashboard`, `MyParties.jsx`)** now has a **Regional Waves** section: each order card shows the chosen **fitting garage + 30-min fitting slot** (tyres) or **delivery address** (electronics), plus items/subtotal/status. (Old VPP sections retained below.)
- **Account panel** added to the consumer console: edit **name + phone** (email shown read-only). New backend `PATCH /api/me/profile` (returns sanitized user, strips `password_hash`).
- **Supplier order-summary** destinations now list **fitting slots per garage** (`↳ slot · N units`). `join_wave` also **derives the slot label from the ISO** server-side if the client omits it.
- **Removed** the "Fitting included / Pick your fitter once the Wave locks" notice from the legacy checkout window (fitter + slot are now chosen *during* wave join).
- Verified: frontend testing_agent iteration_9 (all observable flows PASS), curl, 27/27 regression.

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
