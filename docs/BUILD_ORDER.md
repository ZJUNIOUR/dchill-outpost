# BUILD_ORDER.md

The recommended order to build DChill Outpost, why each phase comes when it does,
and what depends on what. Scope is **pickup-only**; delivery is a future phase.
Phases are dependency-ordered — each leans on the one before it.

> **Start the long-lead item on day one of Phase 0:** US SMS delivery requires
> A2P 10DLC registration (~1–3 weeks of carrier review). It needs no code and
> runs in parallel through every phase below. Launch email-first; flip SMS on
> when approval lands.

---

## Phase 0 — Planning & setup
**Goal:** a working skeleton and the accounts/secrets in place.
- Read `CONTEXT.md`, `MEMORY.md`, `USER_ROLES.md`, `TECHNICAL_ARCHITECTURE.md`.
- Create Supabase project; create **Clover developer account + sandbox app
  (App ID/secret + sandbox merchant)**, Twilio, Resend/SendGrid, Sentry, Apple
  Developer, and Google Play accounts. **Begin A2P 10DLC registration now**, and
  begin Clover **production** merchant approval / OAuth in parallel (build in sandbox).
- Set up repos/monorepo: `mobile/` (Expo), `admin/` (React + Vite),
  `supabase/` (migrations + Edge Functions). Add ESLint/Prettier/TS strict.
- Put all secrets in server/runtime env only. Confirm the service-role key is
  **not** referenced by any client package.
- **Depends on:** nothing. **Unblocks:** everything.

## Phase 1 — Database, auth & roles  *(security foundation — do this first)*
**Goal:** the data model and the role/permission walls exist and are proven.
- Apply `DATABASE_SCHEMA.sql`: tables, enum, `auth_user_role()`, RBAC catalog,
  RLS policies, the `protect_owner_admin` and `protect_owner_permission`
  triggers, indexes, constraints, and seed roles/permissions/settings.
- Manually run the **Owner bootstrap** once (trusted operator) to create the
  first `owner_admin`. Never auto-seed a second Owner.
- Wire Supabase Auth (email/phone + password, forgot-password, JWT role claim).
- Build the Edge Function `owner-checked-credential-change` and confirm the
  service-role key is read only from runtime env.
- **Run `test_technology_specialist_rbac.sql` — all restriction tests must PASS.**
- **Depends on:** Phase 0. **Unblocks:** every feature that reads/writes data.
- **Why first:** every later feature sits on this schema and these policies.
  Building features before the walls means retrofitting security — the most
  common way owner-protection holes get introduced.

## Phase 2 — Admin inventory system
**Goal:** staff can stock the store.
- Admin dashboard shell with role-aware navigation (reads `role_permissions`).
- Product/category CRUD, image upload to Storage, pricing/sale price.
- Inventory levels, low-stock thresholds, inventory logs, manual adjustments.
- Barcode records (multi-barcode per product) + admin barcode tools.
- **If products live in Clover (optional):** build the one-way **Clover→Supabase**
  catalog sync (`clover-sync-catalog` + `clover-sync-webhook` + `clover-token-refresh`),
  mapping items/SKUs/barcodes/prices/stock onto the Clover ID columns; set
  `system_settings.clover_sync_mode`. Server-side only; tokens in `clover_credentials`.
- **Depends on:** Phase 1. **Unblocks:** customer browsing (needs real catalog)
  and order fulfillment (needs inventory truth).

## Phase 3 — Customer product browsing
**Goal:** customers can find products in the mobile app.
- Expo app shell, auth screens, profile + saved (account-use) addresses.
- Category browse, search (name/brand/category/barcode/keyword), filters,
  product detail with stock status, favorites, featured/Caribbean surfaces.
- **Depends on:** Phases 1–2. **Unblocks:** scanning and ordering.

## Phase 4 — Barcode scanner
**Goal:** scan a product and act on it.
- Customer scanner (`expo-camera` `CameraView`, `onBarcodeScanned`): lookup →
  product detail → add-to-cart → "not found" path; manual entry fallback.
- Admin scanner: lookup, add-product-by-barcode, restock, reprice,
  duplicate-warning, confirm-item-during-prep.
- **Depends on:** Phases 2–3 (needs catalog + barcode records).
- **Why here:** it's an accelerator on top of browse/inventory, not a
  prerequisite for them.

## Phase 5 — Pickup ordering
**Goal:** a customer can place and pay for a pickup order; staff can fulfill it.
- Cart + edit + subtotal/tax; pickup time-slot picker (reads generated slots +
  prep-time guard); order notes.
- **Payment via Clover (labeled assumption — see `MEMORY.md`):** default in-app
  payment at checkout using **Clover Hosted Checkout**. Server-side
  `clover-create-checkout` (recomputes total, creates session) → app opens hosted
  URL in an in-app browser → `clover-payment-webhook` (idempotent on
  `clover_payment_id`) confirms → order `pending`. All Clover credentials server-only.
  Keep pay-at-pickup as a separate, configurable mode (`payment_model`).
- Inventory transaction: reserve on checkout, **decrement on admin accept**,
  restore on cancel; every change logged.
- Admin order queue (realtime): accept/reject, status updates, edit items /
  mark unavailable / substitute, contact customer, ready, complete, cancel.
- Nightly `pg_cron` slot generation honoring order windows + prep time + caps.
- **Depends on:** Phases 1–4. **Unblocks:** notifications (status changes fire
  messages).

## Phase 6 — Notifications
**Goal:** customers and admins are kept informed.
- Email (Resend/SendGrid) live: confirmations, receipts, status updates.
- SMS (Twilio) wired and code-complete; **goes live when A2P 10DLC approves.**
- Notification logging, failed-send tracking, admin resend, opt-out for
  marketing only (order/pickup messages always send).
- Admin dashboard alerts (new order, cancel, low stock, customer note).
- **Depends on:** Phase 5 (order events) + the Phase-0 registration track.

## Phase 7 — Testing & security hardening
**Goal:** prove it works and is safe.
- Full pass of `docs/TESTING_CHECKLIST.md`: customer app, admin, inventory, barcode,
  orders, notifications, role/permission, **Technology Specialist restriction**,
  **Owner protection**, RLS, security, edge cases.
- Re-run `test_technology_specialist_rbac.sql`; tighten Edge Function CORS to
  real origins; Sentry on all surfaces; backup/restore drill; audit-log review.
- **Clover payment testing** (sandbox → production): success/failure/incomplete
  redirects, webhook idempotency on `clover_payment_id`, and the reconciliation
  poll for missed webhooks. **Inventory sync testing** (if catalog sync is on):
  item/SKU/barcode/price/stock mapping and `clover_sync_status` conflict flags.
  Confirm no Clover secret is reachable by any client or by a Technology Specialist.
- Load-check slot booking and inventory decrement under concurrency.
- **Depends on:** Phases 1–6.

## Phase 8 — Deployment & client handoff
**Goal:** live store + a team that can run it.
- EAS builds + App Store / Play submission (budget 2–5 days review).
- Deploy admin web (Vercel/Netlify); deploy Edge Functions; production env/secrets.
- **Swap Clover sandbox credentials for production** (OAuth/merchant + Ecommerce
  tokens) in Edge Function secrets / `clover_credentials`; verify a live test charge.
- Seed real catalog/inventory; staff training; launch readiness checklist signed.
- Flip SMS on once 10DLC is approved. Document runbooks + the Owner bootstrap.
- **Depends on:** Phase 7.

---

## Dependency map (quick reference)

```
Phase 0  setup ─────────────► everything
Phase 1  db/auth/roles ─────► 2,3,4,5,6 (security foundation; build first)
Phase 2  admin inventory ──► 3 (catalog), 5 (fulfillment)
Phase 3  customer browse ──► 4 (scan), 5 (order)
Phase 4  barcode ──────────► accelerates 2,3,5 (not a blocker)
Phase 5  pickup ordering ──► 6 (events)
Phase 6  notifications ────► (needs 10DLC track from Phase 0)
Phase 7  test/security ────► 8
Phase 8  deploy/handoff
```

**Two things that gate the launch date and are not your code:** A2P 10DLC SMS
registration (start Phase 0) and App Store / Play review (Phase 8). Plan the
build to reach a working, email-notifying MVP, then enable SMS on approval.
