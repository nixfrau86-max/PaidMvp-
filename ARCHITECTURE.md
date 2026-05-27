# The Collective Savers™ — Architecture & Decision Log

> Living document. Update whenever a meaningful design, data, or product decision changes.
> Source of truth for "why is it built this way" — pair with `/app/memory/PRD.md` (what) and `/app/memory/CHANGELOG.md` (when).

---

## 1. Product Vision

**The Collective Savers™** is a real-time demand-aggregation platform built on **Value Party Power Systems (VPPs)** — branded as **"Waves"**. Consumers group-buy in time-bounded cohorts to unlock supplier pricing on products like tyres, electronics, and other high-margin verticals.

**UX north star**: Premium, invisible infrastructure (Stripe / Monzo / Linear). The user sees **savings unlocked**, never platform plumbing. Fees, splits, and commission live in the background.

---

## 2. Core Roles

| Role | Entry point | Capabilities |
|---|---|---|
| **Consumer** | Email/Password, Google OAuth, SMS OTP | Join Waves, pre-authorise payment, book fitter post-lock |
| **Supplier** | Tiered onboarding (Provisional → Pending → Verified → Payout Ready) | Publish Waves, fulfil orders |
| **Garage / Fitter** | Onboarding + availability calendar | Receive bookings, sync via iCal feed |
| **Admin** | `ADMIN_EMAILS` allowlist (env-driven, seeded founder) | Approve suppliers/waves, force state, configure fees |

---

## 3. Tech Stack

| Layer | Tech | Notes |
|---|---|---|
| Frontend | React 19 + React Router + Tailwind + Shadcn UI + Phosphor Icons | SPA. Brutalist design tokens (`shadow-brut`, `border-ink`, custom display fonts) |
| Backend | FastAPI (Python) + Motor (async MongoDB) | Currently monolithic `server.py` (~2,300 LOC) |
| DB | MongoDB | Collections: `users`, `vpps`, `vpp_participants`, `suppliers`, `garages`, `garage_bookings`, `payment_transactions`, `user_sessions`, `login_attempts`, `waitlist`, `platform_config` (planned) |
| Realtime | FastAPI WebSockets | Rooms: `vpp:{id}`, `vpps:all` |
| Payments | Stripe (via `emergentintegrations`) + mocked Open Banking / Bank Transfer | Stripe Connect deferred (P2) |
| Auth | Custom JWT + Emergent Google Auth + Twilio SMS OTP (DEV mode) | Bcrypt password hashing |
| Calendar | RFC-5545 dynamic `.ics` feed | Chose over Google OAuth for universal sync (Apple/Google/Outlook) |

---

## 4. Repository Layout

```
/app
├── backend/
│   ├── server.py             # Monolithic FastAPI app (auth, VPPs, checkout, suppliers, garages, calendar, admin)
│   ├── requirements.txt
│   ├── .env                  # MONGO_URL, DB_NAME, STRIPE_API_KEY, FOUNDER_EMAIL/PASSWORD, ADMIN_EMAILS, CORS_ORIGINS
│   └── tests/                # pytest (regression target)
├── frontend/
│   ├── package.json
│   └── src/
│       ├── App.js            # Router config
│       ├── components/       # Navbar, StateBadge, etc.
│       ├── pages/            # Landing, Login, Browse, VPPDetail, Checkout, CheckoutSuccess,
│       │                     # MyParties, BookFitter, SupplierOnboarding, SupplierDashboard,
│       │                     # SupplierWaveNew, GarageOnboarding, GarageDashboard, AdminPanel, AuthCallback
│       └── lib/              # api.js (axios w/ REACT_APP_BACKEND_URL), auth.jsx (context)
├── memory/
│   ├── PRD.md                # What we're building
│   ├── CHANGELOG.md          # When things shipped
│   └── test_credentials.md   # Seed accounts for testing
├── test_reports/             # iteration_*.json from testing agent
└── ARCHITECTURE.md           # ← THIS FILE
```

---

## 5. Key Data Models (high-level)

### `users`
`{user_id, email, password_hash, name, role: consumer|supplier|garage|admin, auth_methods: [email|google|sms], supplier_id?, garage_id?, phone?, created_at}`

### `vpps` (Waves)
`{vpp_id, title, description, category, image_url, supplier_id, supplier_name, supplier_cost, retail_price, customer_price, threshold, max_participants, participants_count, deadline, state: seed|active|powered|locked|executing|completed, publish_status: live|pending_approval|rejected, created_at, powered_at, locked_at, completed_at}`

### `vpp_participants`
`{participant_id, vpp_id, user_id, user_email, user_name, joined_at, paid, payment_method, payment_session_id, fulfilment_status, garage_id?, delivery_address_*?}`

### `payment_transactions`
`{session_id, user_id, vpp_id, amount, currency, payment_method, status, payment_status, metadata, created_at, mock?}`
> **Planned addition** (commission rework): `retail_price`, `wave_price`, `service_fee`, `payment_fee`, `final_price`, `total_savings`, `commission`.

### `garages`
`{garage_id, user_id, business_name, status, availability[], calendar_feed_token, is_active, ...}`

### `garage_bookings`
`{booking_id, garage_id, user_id, vpp_id, slot_iso, status, ...}`

### `platform_config` *(planned — fee engine)*
Single doc keyed `_id="fees"`:
```
{
  commission_pct: 0.02,         # supplier-side, hidden from consumer
  service_fee_flat: 4.0,        # user-visible Platform Service Fee
  payment_methods: [
    { id, label, sub, fee, recommended, enabled, order }
  ]
}
```

---

## 6. State Machine — Wave Lifecycle

```
seed → active → powered → locked → executing → completed
                  │          │
                  └──────────┴──── (auto-transition in `_transition_vpp_if_needed`)
```

- **active**: accepting joiners
- **powered**: threshold reached (auto-locks immediately in MVP)
- **locked**: payments captured, fitter selection unlocked
- **executing**: supplier dispatching
- **completed**: fulfilled

---

## 7. Critical Architectural Decisions (ADRs)

### ADR-001 · Single monolithic `server.py`
**Status**: Active, refactor pending.
**Context**: Fast iteration in MVP phase. Now ~2,335 lines.
**Trigger to refactor**: Any new major feature → break into `/app/backend/routes/{auth,vpps,checkout,suppliers,garages,calendar,admin}.py` + `/app/backend/models/` + `/app/backend/services/`.

### ADR-002 · Garage selection moved POST-LOCK
**Status**: Locked.
**Context**: Original design put garage selection in `Checkout.jsx`. User feedback: it clutters checkout and delays pre-auth.
**Decision**: Pre-auth first → Wave locks → email/CTA → `BookFitter.jsx`.
**Never revert without explicit user approval.**

### ADR-003 · iCal feed over Google Calendar OAuth
**Status**: Locked.
**Context**: Fitters need calendar sync; full OAuth is high-friction across providers.
**Decision**: Dynamic per-garage `.ics` feed at `GET /api/calendar/garage/{id}.ics?token=...`. Token is rotatable.

### ADR-004 · Admin role bound to `ADMIN_EMAILS` allowlist
**Status**: Locked.
**Context**: Earlier MVP had a public role-switcher in the navbar — security risk.
**Decision**: Admin requires the user's email to match `ADMIN_EMAILS` (env). Founder seeded via `FOUNDER_EMAIL/PASSWORD` on startup.

### ADR-005 · Hide platform fees on landing & browse
**Status**: Locked.
**Context**: Waitlist-led launch. Public product pricing is not exposed pre-signup.
**Decision**: `/vpps` and detail views only show retail vs. collective price; fee breakdown lives behind auth in checkout.

### ADR-006 · Configurable fee engine (in progress)
**Status**: Planned — implementation starting next.
**Context**: Need to support platform commission + payment-method fees + lower-cost rail incentives without coupon-site UX.
**Decision**: Single-doc `platform_config` collection. Admin-editable. Checkout fetches via `GET /api/checkout/quote/{vpp_id}` and renders live totals as user picks method.
**Constraint**: Never expose "commission" to consumer. Only "Platform Service Fee" + "Payment Method Fee" + "Total Savings".

### ADR-007 · Emergent-managed Google Auth (not custom OAuth)
**Status**: Locked.
**Context**: Avoid managing Google Cloud Console for MVP.
**Decision**: Use Emergent's session callback flow (`/auth/session`).

### ADR-008 · Twilio SMS OTP — DEV mode
**Status**: Temporary.
**Context**: Twilio credentials not yet provided.
**Decision**: OTPs log to backend console. Production wiring is a P1 item.

---

## 8. Current State Snapshot

**As of Feb 2026 (latest fork):**

✅ **Shipping**
- Waitlist-led landing page
- 3-way auth (Email/Password, Google OAuth, SMS OTP DEV mode)
- Consumer browse + Wave join + checkout
- Stripe card + mocked Open Banking / Bank Transfer
- Supplier tiered onboarding + admin approval queue
- Garage onboarding + availability + bookings + iCal feed
- Post-lock fitter booking flow (`BookFitter.jsx`)
- Admin Panel: stats, Waves, pending Waves, suppliers
- Founder admin seeded via env

🟡 **In progress / next**
- Configurable fee engine + commission/payment rework (ADR-006)
- Admin "Fees & Payments" tab

🔴 **Mocked / deferred**
- Open Banking (TrueLayer/Plaid)
- Bank Transfer (Faster Payments)
- Twilio SMS (DEV mode)
- Stripe Connect for split payouts
- Email notifications (Resend/SendGrid)
- Apple Sign-in (blocked on Apple Developer Program)

---

## 9. Environment Contracts

**Never delete protected keys.** Always read from env — no fallbacks.

| Var | Owner | Purpose |
|---|---|---|
| `MONGO_URL`, `DB_NAME` | backend/.env | Mongo connection |
| `REACT_APP_BACKEND_URL` | frontend/.env | API base — production-routed |
| `STRIPE_API_KEY` | backend/.env | Stripe (test key `sk_test_emergent` in pod) |
| `FOUNDER_EMAIL`, `FOUNDER_PASSWORD` | backend/.env | Seeded admin |
| `ADMIN_EMAILS` | backend/.env | Comma-separated admin allowlist |
| `CORS_ORIGINS` | backend/.env | CSV of allowed origins |
| `TWILIO_*` | backend/.env (pending) | When SMS OTP goes live |

---

## 10. Testing & Quality

- **Backend regression**: `pytest /app/backend/tests` (build out as features land)
- **E2E**: `testing_agent_v3_fork` — reports land in `/app/test_reports/iteration_*.json`
- **Smoke**: One screenshot post-implementation, then offload to testing agent
- **Test credentials**: `/app/memory/test_credentials.md` (kept current — read by testing agent)

---

## 11. Open Risks

1. **`server.py` size** — refactor pressure increasing. Hard threshold: next major feature triggers split.
2. **Single-doc `platform_config`** — fine for MVP; needs versioning + audit log before scale (admins changing fees blindly is a risk).
3. **No email transactional layer** — supplier approvals, wave locks, booking confirmations are silent today.
4. **Stripe Connect absent** — supplier payouts are manual until ADR-009 (future).

---

## 12. How To Update This File

- New ADR → append to §7 with `ADR-NNN · short name`, status, context, decision.
- State change (mocked → live, deferred → shipped) → update §8.
- New collection / model → update §5.
- New env var → update §9.
- Keep it under ~400 lines. Move history to `CHANGELOG.md` when it grows.
