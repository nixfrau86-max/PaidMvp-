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

## What's implemented (latest — 2026-06-27b)
### ⚡ N+1 query optimisations + code-review triage (DONE)
- **Applied (real, low-risk):** batched 4 N+1 query patterns flagged by the deployer/review into single `$in` lookups: `GET /me/wave-orders`, `GET /admin/regional-waves`, `GET /admin/scheduled-waves`, `GET /me/parties` (VPP fetch). All verified 200 with correct data; 36 unit tests pass.
- **Restored** missing `member_demo@collective.co` consumer test account (recreated fresh, no seeded order).
- **Declined as false positives (verified):** "7 undefined variables" (pyflakes clean), "71 `is` vs `==`" (all `is None/True/False` — correct PEP8 singleton checks; zero literal misuses), most "missing hook deps" (suggested deps are stable imports/local vars, not reactive). Console-statement cleanup was already applied previously.
- **Deferred (high-risk, needs dedicated phase):** `build_router()` complexity splits (waves/admin_users/wave_payments), `WaveDetail.jsx` component split, TS adoption, lazy-loading, nested-ternary/inline-object cleanup.

## What's implemented (latest — 2026-06-27)
### ♻️ Regeneration now relists on STOCK-LEFT (fixes "waves not restarting") (DONE)
- **Root cause:** regeneration only fired for ACTIVATED→COMPLETED waves. Relaunched rounds that got too few joins EXPIRED, and expired waves never regenerated → the chain stopped → marketplace went empty.
- **Fix (user chose option A):** a wave now relists whenever **stock remains**, regardless of demand. `complete_wave_and_respawn` demand-gate removed (now only `total_remaining <= 0` stops it); `expire_overdue_waves` now calls `complete_wave_and_respawn` so under-filled/expired-but-stocked waves relist on the next working-day schedule, keeping original targets. ⚠️ A wave nobody buys relists every working day indefinitely (admin can Cancel from the Scheduled Regenerations panel). 36 backend tests pass.
- **Marketplace repopulated:** relisted the 4 expired-but-stocked product lines live (Continental Tyres R4, Air Jordans R3, Air Jordan 4 R3, Nike Footwear R4). Purged TEST_* waves created by the live test suite. 4 clean live waves now showing.
- NOTE: the API-based test suite (`test_wave_lifecycle.py`) creates `TEST_*` waves in the shared DB; with relist active they can reappear live — purge with a `^TEST_` title delete after running it.

## What's implemented (latest — 2026-06-26c)
### 🎛️ Admin control over queued waves + 🧹 test-wave purge (DONE)
- **Admin start/queue control:** the Admin "Scheduled Regenerations" panel now has per-row **Start now** (force-launch a queued regeneration live immediately, deadline = today's cut-off) and **Cancel** (remove from queue so it never launches). New endpoints `POST /api/admin/scheduled-waves/{id}/start` and `DELETE /api/admin/scheduled-waves/{id}`; materialisation refactored into `_materialize_scheduled_wave` (shared with the background worker). Verified via curl (start → live open wave; cancel → removed).
- **Purged test waves:** removed 10 `TEST_RSPAWN_*` / `TEST_MERGE_*` / `TEST_*` waves + their scheduled entries (10) + participations (8). 10 real waves remain.

## What's implemented (latest — 2026-06-26b)
### ♻️ Regeneration rules refined (cut-offs + original targets) (DONE)
Per refined spec: a wave regenerates while **stock is left**, with timing:
- **Mon–Fri**: regenerate immediately if before **16:30** (deadline = 16:30, corporate close); after 16:30 → next working day 08:30.
- **Saturday**: runs until **midnight** (deadline = Sat 23:59); regenerate immediately anytime that day.
- **Sun + UK bank holidays**: no regeneration → relaunch **Monday 08:30**.
- Regenerated waves now keep the **ORIGINAL `ideal_target` & `min_activation`** (carried across rounds), with leftover stock as inventory — not the reduced leftover count.
- Impl: `_day_cutoff_hm`, updated `_respawn_schedule` (16:30 weekday / midnight Sat cut-off), `_deadline_for_creation_london` (16:30 vs Sat-midnight), `_build_respawn_doc` keeps original targets. Tests updated → **25 passed**. Verified live (immediate Round 2, ideal 50 / min 40 preserved, deadline Fri 16:30).
- CAVEAT: if leftover stock < min_activation a round can't activate (may relist daily) — acceptable for high-inventory waves; flag if you want min_activation auto-capped to remaining stock.

## What's implemented (latest — 2026-06-26)
### 🔒 Waves access control + ♻️ regeneration (immediate + monitor) (DONE)
- **Unauthorised-access audit + fix:** the consumer Waves marketplace (`/waves`, `/wave/:id`) is now **members-only** — **anonymous → /login**, **suppliers → /supplier**, **garages → /garage**; only consumer/admin can view (early-render auth gate prevents content flash; data fetch gated on authorisation). The front-page hero cards (`HeroWaves`) deep-link to a wave only for **consumer/admin**, route **anonymous → /login** (signup funnel), and are **non-clickable for supplier/garage**. NOTE: the public `GET /api/waves[/{id}]` API stays open (marketplace data is non-sensitive); frontend role-redirects are the access boundary.
- **Regeneration reviewed — engine works** (proven via live reproduction: auto-complete → schedule → materialise → Round 2). Root cause of "not working" was the prior next-working-day deferral being invisible. **Fixed (option C):** `_respawn_schedule()` now launches a respawn **immediately** when completed during working hours (Mon–Sat ≥08:30), else schedules today 08:30 (if before open) or the next working day (Sun/bank holidays). `complete_wave_and_respawn` restored the immediate-live branch.
- **Auto-engine monitor:** new `GET /api/admin/scheduled-waves` + a **"Scheduled regenerations"** panel in the Admin Regional Waves tab — shows each queued Round, supplier, region, leftover units, carried units, and London go-live time.
- Tests: `_respawn_schedule` immediate/before-open/Sunday/bank-holiday cases added → **19 passed** (respawn + window + auto-complete).

## What's implemented (latest — 2026-06-25)
### 📦 Stock monitoring (supplier + admin) (DONE)
- `_public_wave(full=True)` now returns `stock_summary {total, allocated(reserved-unpaid), sold(paid), left}`. Supplier console (`SupplierWaves`) + Admin Regional Waves table show A/S/L badges per wave.

## What's implemented (latest — 2026-06-24)
### 🗓️ Wave schedule rework + test-user purge (DONE)
- **Removed the 16:30 (4:30pm) cut-off.** Waves now run until **midnight** on their launch day (`_deadline_for_creation_london` → 23:59:59 London). No more same-day immediate respawn.
- **Working week = Monday–Saturday**, excluding **Sundays + UK (England & Wales) bank holidays** (new `holidays==0.99` dep; `_is_working_day`). Launch time stays **08:30**.
- **Orders placed the following working day:** `complete_wave_and_respawn` now **always schedules** the leftover-stock respawn for `_next_creation_time_london()` = the next working day at 08:30 (skips Sun + bank holidays). The old "immediate inside window" branch was removed.
- Tests updated: `test_wave_respawn.py` (4 schedule cases incl. Fri→Sat, Sat→Mon, Good-Friday skip) + `test_wave_lifecycle.py::TestRespawnWorkingWindow` (midnight deadline). **15 passed.**
- **DB cleanup:** purged **332 test users** (all `test_*`, `@example.com`, `wavetest_/tyretest_/elec_/garage_/acct_/lbl_/card_/dbg_/ui_` artefacts + the 2 named test admins `test_377c3ca6@`, `test_43d7ccba@`) plus their sessions (329) + participations (131). **19 real accounts preserved**; only `founder@thecollectivesavers.co.uk` remains admin. Founder + demo logins verified 200.

## What's implemented (latest — 2026-06-24)
### 🖼️ Per-product images in wave creation (DONE)
- Suppliers attach a photo **per product** (not just per wave) in the Products & options section (`SupplierWaves.jsx`, reuses `/api/supplier/wave-image`). Backend: `image_url` on `ProductInput`, persisted via `_normalize_products`, surfaced in `_public_wave`, carried into respawns. Consumer `WaveDetail.jsx` Step 1 shows product-tab thumbnails + a hero image for the selected product. Verified end-to-end via curl.

## What's implemented (latest — 2026-06-24)
### 🎨 Landing graphics refresh (DONE)
- Bigger navbar logo. New hero is a 2-col layout with an animated **live Waves** visual (`HeroWaves.jsx`) wired to **real `/api/waves` data** (category icon, progress, joined count, computed savings %; clickable to `/wave/:id`; illustrative fallback if no live waves) + a social-proof stat strip. Scroll-triggered entrance animations (Framer Motion `whileInView`) on the "How it works" cards + manifesto.

## What's implemented (latest — 2026-06-19)
### 📧 Resend transactional emails (IMPLEMENTED — awaiting API key to go live)
- `backend/email_service.py`: non-blocking async Resend layer (`send_email` + branded HTML templates) that **gracefully no-ops if `RESEND_API_KEY`/`SENDER_EMAIL` are unset**, so the app runs without credentials. Loads env via `load_dotenv()`.
- **Wired events** (all fire-and-forget via `asyncio.create_task`, never break the request): (1) **reservation confirmation** on wave join — incl. fitting slot for tyres / delivery address for others (`routes/waves.py join_wave`); (2) **wave activation** notification to **all active participants** the moment a wave flips to `activated` (`_recompute_wave` → `_notify_wave_activation`); (3) **payment receipt + fitting confirmation** on capture (`routes/wave_payments.py settle_wave_participation`).
- `.env`: `SENDER_EMAIL=founder@thecollectivesavers.co.uk`, `APP_BASE_URL=<preview>`, `RESEND_API_KEY=` (empty — **pending user key**). Resend SDK added to `requirements.txt`.
- **Status**: code complete & backend healthy; **needs the Resend API key + verified domain `thecollectivesavers.co.uk` to test a live send.**

### 🧹 Code-quality pass #2 (review findings — verified against real linters)
- **Fixed (genuine):** removed unused imports (`send_payment_receipt` in `waves.py`; `json`/`status`/`JSONResponse`/`EmailStr` in `server.py`) → pyflakes clean. Added a dev-only `src/lib/log.js` (`logError`/`logWarn`, silent in production) and used it in `WaveBrowse`/`WaveDetail` catch blocks — resolves the contradiction between review #1 ("remove console") and review #2 ("don't use empty catch"). Fixed `Landing.jsx:52` index key.
- **Verified as NOT bugs (tool noise):** pyflakes found **0 undefined variables** (report claimed 7); CRA build-eslint reports **0 `react-hooks/exhaustive-deps` warnings** on the flagged files (report's "60 missing deps" lists globals/imports like `WebSocket`/`api`/`data`, which the real rule never flags); the 72 `is True/False/None` test comparisons are valid Python (no `is <int/str>` identity bugs).
- **Deferred (high-risk/large, documented):** `build_router()` splits (waves/wave_payments/admin_users/admin_suppliers), large-component splits (WaveDetail/AdminPanel/BookFitter/Checkout), nested ternaries in legacy pages, type-hint coverage — these need a dedicated, test-guarded refactor pass (one unit at a time) to avoid regressing tested production code.

## What's implemented (latest — 2026-06-19)
### 🧹 Code-quality pass (review findings) (PARTIAL — safe fixes applied, risky refactors deferred)
Applied the **safe, high-value** review fixes; **deliberately deferred** large refactors that would risk regressing tested, production code.
- **Fixed — Security #1:** moved hardcoded test credentials to env-with-default (`os.environ.get("TEST_SUPPLIER_*"/"TEST_ADMIN_*", default)`) in `test_wave_image_upload.py`, `test_supplier_summary_financials.py`, `test_fitting_slot_uniqueness.py`.
- **Fixed — Array-index keys #4:** `GarageDashboard.jsx` (weekly/override range rows → content-composite keys; HowTo steps → `key={s}`), `WaveBackground.jsx` (extracted `WAVE_LINES`/`PULSE_NODES` constants + stable `d`/`cx-cy` keys).
- **Fixed — Inline objects in props #9:** extracted framer-motion config to module constants in `WaveBrowse.jsx` (`CARD_HOVER`, `CARD_SPRING`, `BAR_INITIAL`, `BAR_SPRING`) and `WaveDetail.jsx` (`BAR_*`, `PULSE_*`); extracted `GOOGLE/APPLE/OUTLOOK_STEPS` arrays in `GarageDashboard.jsx`.
- **Fixed — In-render computation #11:** `useMemo` for the overrides sort (`GarageDashboard.jsx`) and payment-methods sort (`admin/FeesTab.jsx`).
- **Fixed — Console statements #10:** removed all `console.*` from `WaveBrowse.jsx`, `WaveDetail.jsx`, `GarageDashboard.jsx` (now 0).
- **Reviewed / not bugs:** #3 hook-dep flags on `WaveBrowse/WaveDetail` are tool noise (it lists globals/imports like `WebSocket`, `URLSearchParams`, `api`); the `useCallback` deps are correct. #6 `is True/False/None` in tests are correct Python (no `is <int/str>` identity bugs found); converting to `== True` would trip E712.
- **Deferred (high risk / low ROI):** #5 `build_router()` splits (waves/wave_payments/admin_users), #7 component splits (WaveDetail/AvailabilityEditor/AdminPanel), #8 nested ternaries in legacy pages, #12 type-hint coverage. These touch working, fully-tested code; safe extraction needs a dedicated, separately-tested refactor pass.
- **Verified:** all touched backend tests pass (10/10); frontend compiles clean; WaveBrowse mounts/renders.

## What's implemented (latest — 2026-06-19)
### 🅿️ Per-slot fitting capacity (garage bays) (DONE)
Garages can now take **more than one fitting per 30-min slot** (e.g. a 2-bay garage = 2 cars/slot) instead of a hard 1.
- **Backend**: `garage_availability` gains `slot_capacity` (default 1, clamped 1–20); `GarageAvailability` model + `PUT /garages/me/availability` persist it. Slot occupancy is now **count-based**: `GET /garages/{id}/slots` tallies confirmed bookings + active wave reservations per slot and offers it while `count < capacity`, returning `remaining` & `capacity` per slot. `join_wave` and the legacy `create_booking` reject (409) only once a slot is **fully booked** (`held + booked >= capacity`); self re-joins excluded.
- **Frontend**: Garage dashboard availability editor has a **"Bays / cars per slot"** selector (`data-testid=slot-capacity`) saved alongside slot length; the stats strip shows "Xmin · N bays". The member slot picker (`WaveDetail.jsx`) shows a subtle "· N left" on each slot when capacity > 1.
- **Tests** (`tests/test_fitting_slot_uniqueness.py`, 2): capacity-1 (second joiner 409, slot vanishes) **and** capacity-2 (two members share a slot, `remaining` decrements 2→1→gone, third joiner 409). Both green.

## What's implemented (latest — 2026-06-19)
### 🔧 Fitting-charge notice + one-customer-per-garage-slot (DONE)
- **Garage notice** (`WaveDetail.jsx`, `data-testid=fitting-charge-notice`): when a member is choosing an approved fitting garage (tyres), an amber notice now explains the wave price covers **tyres only** and that **fitting is arranged with and charged separately by the garage** on the day. Visually confirmed.
- **No double-booking a garage+slot:** the slot list (`GET /garages/{id}/slots`, `server.py`) now treats a slot as taken if it has a confirmed legacy booking **OR** an active wave reservation (reserved/authorized/captured) — so a held slot disappears from the picker even before payment. `join_wave` (`routes/waves.py`) also rejects a join (HTTP 409) if another member already holds that garage+slot, preventing over-allocation to one garage/time. Self re-joins/merges are excluded so a member doesn't clash with their own reservation.
- **Tests**: `tests/test_fitting_slot_uniqueness.py` (slot vanishes from list after first joiner; second joiner → 409). Full new-feature suite green (6 passed).

## What's implemented (latest — 2026-06-14)
### 📋 Richer supplier Order Summary + admin Wave Financials (DONE)
- **Supplier Order Summary** (`GET /supplier/waves/{id}/order-summary`, `SummaryModal` in `SupplierWaves.jsx`) now shows: a **payment-status breakdown** (paid / authorized / reserved units + order counts), **per-destination item detail** (which product·option·qty ships to each garage/address, with fitting slots), and an **Orders & customers** table — per-order customer **name + email + phone**, items, destination/fitting, and a payment badge. Variant breakdown now also shows paid units.
- **Admin Wave Financials** (`GET /admin/regional-waves/{id}/financials`, admin-only; new `FinancialsModal` + `£` button per row in `RegionalWavesTab.jsx`): **Committed vs Paid** cards (Revenue = wave price × units, Supplier cost, Gross margin, RRP value, Savings to customers) + a per-variant table. Supplier cost is sourced from the wave doc (never exposed to suppliers).
- **Tests**: `tests/test_supplier_summary_financials.py` (e2e: create wave → consumer joins → asserts enriched summary fields + exact financial maths + admin-only guard). Frontend verified by testing agent **iteration_13: 100%** (both modals, exact numbers for Midlands LG wave, close + zero console errors). Added defensive `|| []` guards on the new array reads.

## What's implemented (latest — 2026-06-14)
### ♻️ Auto wave engine expanded to all categories (automatic completion → respawn) (DONE)
The auto-respawn engine was already category-agnostic, but it only fired when an **admin manually** set a wave to `completed` — so respawn never happened on its own, for any category. Added an automatic-completion worker so the engine is now hands-off across **every product category** (manual admin completion still works too).
- **New worker** `auto_complete_due_waves(db, manager)` (`routes/waves.py`), symmetric with `expire_overdue_waves`: any **`activated`** wave whose **`deadline`** has passed (and not yet respawned) auto-transitions to `completed`, then runs `complete_wave_and_respawn` — captured units recorded as sold, stranded reservations carried into a fresh `· Round N` follow-on for the leftover stock (live if inside the Mon–Fri 08:30–16:30 London window, otherwise scheduled). Wired into the 60s startup loop in `server.py` (alongside the scheduled-respawn, payment-sweep and expiry workers).
- Behaviour is identical for tyres, electronics, footwear, and arbitrary "Other (specify)" custom slugs — the worker keys off `state`/`deadline`, never the category.
- **Tests** (`tests/test_wave_auto_complete.py`, 4): auto-complete+respawn for electronics, footwear and a custom `pet_supplies` slug (carried units + Round 2 + leftover target asserted, live-or-scheduled), plus a negative test (open/under-filled and future-deadline waves are left untouched). Full wave regression **60 passed**.

## What's implemented (latest — 2026-06-14)
### 🖼️ Supplier Wave product images (upload + URL) (DONE)
Suppliers can now attach a **product image** in the "+ Create Wave" and Edit Wave flows; it renders on the live wave cards (`/waves`) and the Wave Detail hero (`/wave/:id`).
- **Object storage** wired via Emergent storage API (`backend/storage.py`: `init_storage`/`put_object`/`get_object`, keyed by `EMERGENT_LLM_KEY`, app prefix `collective-savers`).
- **Backend** (`routes/waves.py`): `POST /api/supplier/wave-image` (supplier-auth, multipart `file`; validates jpg/png/gif/webp + ≤5MB; stores object + `db.files` ref; returns `{image_url:"/api/wave-images/…"}`). `GET /api/wave-images/{path:path}` serves the image **publicly** (no auth, immutable cache headers). `create_wave`/`update_wave` persist `image_url`; `_public_wave` surfaces it.
- **Frontend** (`SupplierWaves.jsx` WaveForm): image section with **file upload OR URL paste**, live preview, and Remove control — sends `image_url` on create + edit. `WaveBrowse.jsx`/`WaveDetail.jsx` render `<img src={w.image_url}>` (relative `/api/...` path resolves against the app origin). Testids: `wave-image-section/-file/-upload-label/-url/-clear/-preview`, plus added `form-title`/`form-eta`.
- **CORS fix** (`server.py`): when `CORS_ORIGINS="*"`, now uses `allow_origin_regex=".*"` so credentialed (cookie) requests reflect a specific origin instead of an invalid literal `*` (note: the preview ingress still injects `*`, so the effect is for custom-domain deploys).
- **Testing** (`iteration_12.json`): **100% backend (7/7 pytest, `tests/test_wave_image_upload.py`)** + **100% frontend** (file upload, URL paste, preview, clear, card + hero render, public serve, validation). Also authoritatively confirmed `/waves` renders cards in a real browser — the earlier "Loading waves…" was a local screenshot-tool artifact, not a bug.
- Deferred review nits (low severity): magic-byte image validation (Pillow), per-variant input testids.

## What's implemented (latest — 2026-06-14)
### 🎨 Phase 4 — Premium UX & Discovery (Stripe/Revolut-inspired) (DONE)
Pivoted the two consumer-facing pages — **Wave Browse** (`/waves`, `WaveBrowse.jsx`) and **Wave Detail** (`/wave/:id`, `WaveDetail.jsx`) — from the hard-brutalist look to a **premium fintech "soft-utility"** aesthetic (per `/app/design_guidelines.json`):
- **Type:** Outfit (headings) + Manrope (body/data) added to `index.css` (`.font-outfit`, `.font-manrope`); replaced JetBrains Mono / Cabinet Grotesk on these pages.
- **Surfaces:** slate-50 app bg, white `rounded-2xl/3xl` cards, delicate `border-slate-100/200`, soft diffused shadows (`shadow-[0_4px_20px…]` resting / `…_12px_40px…` elevation). Removed `shadow-brut` / 0-radius on these pages. Brand `#FF5400` restricted to CTAs + progress fills + accents.
- **Motion:** `framer-motion` (added) — wave-card hover lift (`whileHover y:-4`), spring-animated progress-bar fills (`width 0→pct`), sticky-rail pulse-on-WS-update; live pulse dots on stat pills + the rail header.
- **Browse:** clean hero with live stat pills (`stat-live-waves`, `stat-members`), rounded filter bar, responsive card grid — each card has gradient/image header w/ slate gradient overlay, region pill, rounded-full state badge (emerald/amber/orange/sky/indigo/slate by state), `+N` carried badge, "Save X%" band, live units progress.
- **Detail:** rounded hero, Step 1 variant tiles (orange selected ring + RRP strike + stock), qty stepper, annual-allowance pill, Step 2 garage select + grouped 30-min slot picker / delivery textarea, and a **sticky right rail** with the big live unit counter, % , spring progress bar, carried-units note, collective price + "You save £X" pill, terms + Join CTA + reassurance.
- **Robustness:** generic gradient fallback for arbitrary category slugs; defensive `(w.products||[])`.
- **Housekeeping:** purged 16 `TEST_*` artefact waves (+14 participations) polluting the live browse.
- **Testing:** `iteration_11.json` — **100% on all 8 frontend acceptance scenarios** (browse render/filters/nav, electronics step1+join, tyres step1/2 + join-button guard, live progress rail). No functional regressions; all preserved `data-testid` contracts resolve. Auth still httpOnly-cookie only.
- Deferred review nits (non-blocking): WS reconnect/back-off on the browse feed; slot-picker pagination for high-volume garages.

## What's implemented (latest — 2026-06-12)
### 🏷️ Expanded categories + custom "Other (specify)" (DONE)
- **Wave categories expanded** from 3 → 11 canonical ids (`tyres, electronics, footwear, clothing, home_appliances, home_garden, automotive, beauty, sports, toys, consumer_goods`) in `routes/waves.py` (`CATEGORIES` / `CATEGORY_LABELS`). `GET /api/wave-categories` now returns the full list; the Create-Wave dropdown (`SupplierWaves.jsx`) reflects it.
- **Custom category on wave creation:** the Create-Wave form adds an **"Other (specify)…"** option that reveals a free-text input (`form-category-custom`). On submit the label is slugified and sent as `{category, category_label}`. `WaveCreateRequest.category` is now `str` (+ optional `category_label`); `create_wave` derives & stores `category_label`; `_public_wave` surfaces it. Non-tyre categories ship to a delivery address (unchanged); custom categories fall back to the global default unit limit (`GET /api/me/unit-allowance` made tolerant of unknown categories).
- **Supplier onboarding "Other (specify)":** `SupplierOnboarding.jsx` category tiles expanded (added Footwear, Clothing, Home Appliances); ticking **Other (specify)** reveals a free-text field (`apply-cat-other-text`) whose value is stored in the supplier's `categories`. Existing custom values are restored into the field on edit.
- Tests: `test_wave_lifecycle.py::TestExpandedCategories` (expanded list + custom-category wave create/join + allowance fallback). Backend **49 passed**. Frontend verified by testing agent — all 3 supplier flows PASS (onboarding Other, create-wave Other, create-wave Clothing). Removed a redundant duplicate "Other" dropdown entry flagged by the testing agent.


- **Behaviour:** When a user joins the **same wave** again while they still have an **unpaid** order on it, the new items now **merge into that existing order** instead of creating a second one. Same product/variant → quantities **add up** (2 + 3 = 5 in one line); different variants → added as separate line items in the **same** order. Unit limits & wave capacity apply to the combined total (unchanged).
- **Paid orders never merge:** if the user's prior order on that wave is already **paid/captured**, a repeat join starts a **fresh** order (can't merge into a settled payment).
- **Fitting/delivery:** since it's one order, the **latest** garage + fitting slot (tyres) or delivery address replaces the earlier choice. Any stale in-progress payment session/breakdown on the order is cleared so the next checkout recomputes the combined total.
- **Impl:** `routes/waves.py` — new `_merge_items()` helper + merge branch in `join_wave` (looks up an active `reserved/authorized`, `payment_status != paid` participation for the user+wave). `/join` now returns a `merged` flag. Frontend `WaveDetail.jsx` shows "Added N units to your existing order…" on a merged join.
- Tests: `test_wave_lifecycle.py::TestMergeRepeatJoins` (same-variant sum, different-variant line items, paid-order-doesn't-merge via the mock payment flow). Regression **47 passed**.


Applied a code-review report; **verified findings against the project's own linters** (the report's stricter third-party analyzer over-counted):
- **React hook deps:** report claimed 59 — the project's own ESLint `react-hooks/exhaustive-deps` (same rule CRACO enforces) flagged **3 genuine** ones. Fixed by wrapping fetch fns in `useCallback`: `GarageDashboard.jsx` (`reload`), `SupplierDashboard.jsx` (`reload`), `VPPDetail.jsx` (`load`). Build now compiles with **0 exhaustive-deps warnings**. The other 56 were false positives (transitive vars like `api`, `data`, `err`).
- **Undefined variables:** report claimed 5 — **pyflakes finds 0**. False positives. (Also fixed a pyflakes f-string-without-placeholder nit in `waves.py` seed.)
- **Backend complexity:** extracted `join_wave`'s inline logic (was complexity ~22 / 90 lines) into 5 module-level helpers: `_validate_fulfilment`, `_enforce_unit_limit`, `_atomic_reserve`, `_record_terms_acceptance`, `_build_participation`. `join_wave` is now slim orchestration. Behaviour identical — 44 pytest pass.
- **Array index keys:** fixed the one genuinely reorder-prone list (`VPPDetail.jsx` recent-joiners, which prepends) → stable composite key. The others flagged (GarageDashboard controlled-input time ranges, WaveBackground/Landing decorative/static lists) are not real bugs (controlled inputs / never-reordering lists).
- **Test dynamic import:** replaced `importlib.import_module("routes.waves")` in `test_wave_lifecycle.py` with a static top-level import.
- **Deferred (high regression risk, recommend dedicated task):** full decomposition of the `build_router()` DI-closure functions (the complexity-97 metric is an artifact of the intentional dependency-injection closure pattern, not a defect) and splitting large components (WaveDetail/BookFitter/Checkout/AdminPanel) — these are cosmetic complexity metrics on working, tested code; churning them risks regressions across the app.


- **Carried units (display):** When a wave completes and respawns, the platform now records `carried_units` = the units that were **allocated/reserved but never paid** on the completed wave. This number is stored on the new round's doc and surfaced as an informational badge — **"+N Carried"** on wave cards (`WaveBrowse.jsx`) and **"N units carried from previous wave"** on the wave detail (`WaveDetail.jsx`). The leftover stock already carries forward as available inventory; the **activation progress bar starts at 0** and carried units do **NOT** count toward `min_activation` (per user decision).
- **New respawn working window (Europe/London):** Replaced the old "before 16:00 → now, else next-day 08:00" rule. Working window is now **Mon–Fri 08:30–16:30**. Complete **inside** the window → new wave goes **live immediately** with a **same-day 16:30 deadline**. Complete **before 08:30** → schedule today 08:30. Complete **after 16:30 / weekend** → schedule **next working day 08:30**. Every respawned wave (immediate or scheduled) gets a **16:30 deadline** on its creation day (`_in_working_window`, `_next_creation_time_london`, `_deadline_for_creation_london` in `routes/waves.py`).
- Tests: `test_wave_lifecycle.py::TestRespawnWorkingWindow` (window + deadline helpers) + carried_units assertion in `TestRespawnOnDemand`; updated `test_wave_respawn.py` timing tests. Regression **44 passed**. UI verified (wave detail renders, badge gated on `carried_units > 0`).


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
