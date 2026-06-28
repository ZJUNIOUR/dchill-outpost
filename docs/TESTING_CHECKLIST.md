# TESTING_CHECKLIST.md

Manual and automated testing checklist for the DChill Outpost **pickup-only** MVP.
Use this in Phase 7 (see `BUILD_ORDER.md`) before launch. Check items when verified;
attach notes or links to test runs where helpful.

**Automated gates (must pass before release):**

- `./scripts/run_security_tests.sh` → `ALL SECURITY TESTS PASSED`
- Lint + typecheck clean on `mobile/`, `admin/`, and Edge Functions

---

## 1. Customer app

- [ ] Sign up with valid email/phone; duplicate rejected
- [ ] Login / logout; wrong credentials fail without leaking which field
- [ ] Forgot / reset password (email link or SMS OTP)
- [ ] Profile: edit own name, email, phone; cannot view or edit others
- [ ] Browse categories; hidden and admin-only products never shown
- [ ] Search by name, brand, category, barcode, keyword
- [ ] Product detail shows price, stock status, image, size, brand
- [ ] Out-of-stock items cannot be added to cart
- [ ] Filters and favorites work; favorites are private per customer
- [ ] Featured / weekly deals surface admin-flagged items
- [ ] Saved addresses are account-use only (not used for shipping)

## 2. Admin dashboard

- [ ] Role-aware navigation hides unauthorized modules (UI gating)
- [ ] Unauthorized API actions still blocked by RLS (server enforcement)
- [ ] Today view: orders, pending, completed, low stock, sales activity
- [ ] Product, inventory, pricing, barcode, order, customer, pickup rules, notifications, users, reports, settings modules reachable per role
- [ ] Realtime order feed and low-stock alerts update without refresh

## 3. Inventory

- [ ] Product CRUD; hidden products vanish from customer app
- [ ] Stock levels and statuses (in stock / low / out / hidden / admin-only) reflect quantity
- [ ] Low-stock threshold triggers dashboard alert
- [ ] Reserve on checkout; decrement on admin accept; restore on cancel
- [ ] Every stock change writes `inventory_logs` / `audit_logs`
- [ ] Manual adjustment requires elevated role and records reason
- [ ] No ad-hoc inventory writes outside the documented transactional path

## 4. Barcode scanner

- [ ] Customer: scan resolves product instantly; add to cart when in stock
- [ ] Customer: "Product not found" and manual entry fallback
- [ ] Admin: scan lookup, create product from barcode, restock, reprice
- [ ] Admin: duplicate-barcode warning; confirm item during order prep
- [ ] Uses `expo-camera` `CameraView` (`onBarcodeScanned`); not deprecated `expo-barcode-scanner`

## 5. Pickup orders

- [ ] Cart: add, edit, remove; subtotal and tax shown
- [ ] Pickup slot picker respects prep time and per-slot caps
- [ ] Order notes saved; order created with status `pending` after payment
- [ ] Customer sees only own orders; staff see scoped order queues
- [ ] Admin: accept, reject, preparing, ready, complete, cancel (with reason)
- [ ] Accept decrements stock; cancel restores stock; substitutions respect `substitution_allowed`
- [ ] Each status transition logged and triggers notification
- [ ] **No delivery, driver, or delivery-address checkout flow in MVP**

## 6. Clover checkout

- [ ] `clover-create-checkout` Edge Function recomputes total server-side
- [ ] App opens hosted checkout URL only — no Clover token, key, or secret in client bundle
- [ ] Success, failure, and incomplete redirect paths handled
- [ ] `clover-payment-webhook` idempotent on `clover_payment_id`
- [ ] Order advances only after confirmed payment (`paid`)
- [ ] Reconciliation poll covers missed webhooks (if implemented)
- [ ] Sandbox → production credential swap verified before go-live
- [ ] Refunds/voids documented as Clover Dashboard at MVP (Hosted Checkout)
- [ ] **No Stripe integration anywhere**

## 7. Notifications

- [ ] Transactional email live: account, password reset, order lifecycle
- [ ] SMS code-complete; live when A2P 10DLC approved
- [ ] Order/pickup messages always send; marketing respects opt-out
- [ ] Each send logged; failures tracked; admin resend works
- [ ] Admin alerts: new order, cancel, low stock, customer note, failed send
- [ ] No secrets or full PII in notification logs

## 8. RLS / security

- [ ] RLS enabled on every sensitive table; new tables get policies in same migration
- [ ] Customers read/write only own rows (orders, cart, favorites, profile)
- [ ] `clover_credentials` returns zero rows for all app roles
- [ ] `payments.raw_event` unreadable by app roles
- [ ] `audit_logs` append-only (no UPDATE/DELETE for app roles)
- [ ] Service-role key used only in Edge Functions after authorization checks
- [ ] No secrets in repo, client bundles, logs, or dashboard responses
- [ ] CORS on Edge Functions restricted to real origins (not `*` in production)

## 9. Technology Specialist restrictions

- [ ] `test_technology_specialist_rbac.sql` — all checks PASS
- [ ] TS cannot assign, remove, demote, delete, deactivate, or edit an `owner_admin`
- [ ] TS cannot create another owner or transfer ownership
- [ ] TS cannot modify role-hierarchy / ownership security rules
- [ ] TS cannot read service-role keys, Clover secrets, or backend credentials
- [ ] TS can still manage users and roles **below** owner

## 10. Owner protection

- [ ] Only an existing owner can affect another `owner_admin`
- [ ] `owner.protected` permission attachable to `owner_admin` only
- [ ] Credential changes for owners route through `owner-checked-credential-change` Edge Function
- [ ] Owner bootstrap is manual, audited, and never auto-seeded twice
- [ ] `protect_owner_admin` trigger and owner RLS policies unchanged without owner sign-off

## 11. Launch readiness

- [ ] Real catalog and inventory seeded; staff trained on admin dashboard
- [ ] Production Supabase, admin web, Edge Functions, and mobile builds deployed
- [ ] Clover production merchant credentials in server env only (not clients)
- [ ] Backup/restore drill completed; Sentry on mobile, admin, and Edge Functions
- [ ] A2P 10DLC status documented; email-first launch plan if SMS pending
- [ ] App Store / Play submission submitted; review timeline accounted for
- [ ] Runbooks documented: Owner bootstrap, incident response, key rotation
- [ ] Final security suite + this checklist signed off by owner or delegate
