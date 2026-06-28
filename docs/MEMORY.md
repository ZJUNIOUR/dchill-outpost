# MEMORY.md

Durable decisions future agents and developers **must** remember. Change an entry here only through a deliberate, labeled decision (and update dependent docs/tests).

---

## Locked decisions

1. **MVP is pickup-only.** Customers reserve and pay for pickup orders. There is no delivery in the MVP.
2. **Delivery is NOT in the MVP.** It is a separate future phase requiring its own schema (fulfillment type, delivery address, fees, zones, driver flow). Never slip delivery into MVP tasks.
3. **Owner is the highest, protected role.** Owner = enum `owner_admin`. Only an existing owner may affect another owner. Protection is enforced at the database layer (RLS `USING` + `WITH CHECK`, plus the `protect_owner_admin` trigger), not just in the UI.
4. **Technology Specialist exists and is powerful — but is below Owner.** Enum `technology_specialist`. It can manage products, inventory, pricing, barcodes, orders, customers, pickup rules, notifications (incl. resend), reports, basic settings, maintenance/testing/debug tools, scoped DB troubleshooting, and all users/roles **below** owner. It can **never**: assign/remove/create/demote/delete/deactivate an owner, edit an owner's credentials, transfer ownership, change ownership-level permissions, modify role-hierarchy/security rules, read service-role keys/secrets, or act as DB/system owner. It can never grant itself Owner.
5. **Service-role keys and backend secrets are server-only.** Never shipped to the mobile app or admin client, never committed, never logged, never exposed in any dashboard, never given to a Technology Specialist, and never used to bypass Owner protection. They live only in Edge Function / server runtime env.
6. **Payment runs on Clover (not Stripe).** Card processing uses **Clover Hosted Checkout** for the Expo app: an Edge Function creates the checkout session server-side, the app opens the hosted URL, and a **Clover webhook** confirms payment (idempotent on `clover_payment_id`). *Assumption (separable):* the MVP uses **in-app payment at checkout**; **pay-at-pickup** is a distinct, configurable model (`system_settings.payment_model`) and must not be silently mixed in. **All Clover API calls are server-side; no Clover token, OAuth credential, merchant token, PAKMS key, or app secret ever reaches the mobile app, admin frontend, or client code — and never a Technology Specialist.**
6a. **Clover is primary for catalog, prices, categories, barcodes, and stock.** The store's POS/inventory truth lives in Clover. Supabase stores a **synced mirror/cache** for app browsing, search, RLS-protected queries, customer favorites/cart/order records, and app-specific metadata (featured flags, substitution preferences, pickup availability, etc.). **Client apps must never call Clover directly.** Clover credentials and access tokens are **server-only** (Edge Functions / `clover_credentials`). **Admin inventory writes must eventually go through Supabase Edge Functions** that update Clover first, then sync the Supabase mirror and write `inventory_logs`. The direct Supabase inventory/catalog writes in Phase 2A–2C admin helpers are **temporary local-dev/admin foundation only** — not final production inventory truth. Supabase RLS remains the source of truth for **app permissions** (who can do what); Clover governs catalog/stock/prices and payments, never role boundaries.
7. **Store identity.** DChill Outpost is a Caribbean/international grocery in Rocky Mount, NC. Catalog, search, and "featured" surfaces should treat Caribbean specialty items as first-class (naming, synonyms, categories).
8. **Scope discipline.** Keep the MVP realistic and buildable: one store, managed stack (Supabase + Expo + React/Vite admin), core features only. Defer loyalty, coupons, push, analytics, vendor ordering, web ordering, and multi-location to future phases.

## Canonical technical facts

- **Stack:** Supabase (Postgres + Auth + RLS + Storage + Edge Functions), React Native/Expo (current stable SDK) customer app, React + Vite admin web, **Clover (payments + primary POS/catalog/stock)**, Twilio (SMS), Resend/SendGrid (email), Sentry (monitoring).
- **Catalog/stock source of truth:** Clover (products, categories, prices, barcodes, stock). Supabase mirrors Clover for app reads/writes that go through Edge Functions; Supabase is authoritative for users, roles, orders, carts, notifications, and app metadata.
- **Barcode:** `expo-camera` `CameraView` (`onBarcodeScanned`). `expo-barcode-scanner` is deprecated — do not use.
- **Role source of truth:** `users.role` (`user_role` enum). Fine-grained capabilities live in `role_permissions`. Owner protection keys on the enum value `owner_admin`.
- **Inventory rule:** reserve on checkout, decrement on admin accept, restore on cancel; every change logged. Stock counts in Supabase mirror Clover; production stock mutations go through Clover (Edge Functions), then sync the mirror.
- **SMS reality:** A2P 10DLC registration (~1–3 weeks) gates US SMS delivery; launch email-first, enable SMS on approval. OTP can use Twilio Verify (exempt).
- **Security test:** `test_technology_specialist_rbac.sql` must stay green; it proves the Owner boundary at the DB layer.

## Role hierarchy (high → low)

1. Owner (`owner_admin`) — protected, highest
2. Technology Specialist (`technology_specialist`) — broad technical/admin, below Owner
3. Admin (`admin`)
4. Manager (`manager`)
5. Inventory Staff (`inventory_staff`) / Order Staff (`order_staff`)
6. Staff (`staff`)
7. Customer (`customer`)
8. Guest (`guest`)

(`developer` is a separate backend/infra identity, not part of the operational hierarchy and not store-facing.)
