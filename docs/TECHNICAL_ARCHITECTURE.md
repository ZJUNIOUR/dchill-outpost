# TECHNICAL_ARCHITECTURE.md

Detailed technical architecture for DChill Outpost. Pickup-only MVP. Owner-protected, Technology-Specialist-bounded RBAC. Secrets are server-only.

---

## 1. Recommended stack

| Layer | Choice | Notes |
|---|---|---|
| Customer app | **React Native via Expo (current stable SDK)** | One codebase → iOS + Android; EAS Build for store submission |
| Barcode scanning | **`expo-camera` `CameraView`** | `onBarcodeScanned`; restrict `barcodeTypes` to `ean13, ean8, upc_a, upc_e, code128, qr`. `expo-barcode-scanner` is deprecated |
| Admin dashboard | **React + Vite + TypeScript** | Web app; faster to build/iterate than a second mobile app |
| Backend / DB | **Supabase (Postgres 15+)** | Auth, RLS, Storage, Realtime, Edge Functions (Deno), `pg_cron` |
| Payments | **Clover — Hosted Checkout** | Edge Function creates a checkout session server-side → app opens the hosted URL in an in-app browser → webhook confirms. Card data only ever on Clover's page (lowest PCI). All Clover credentials server-only. |
| SMS | **Twilio** (A2P 10DLC; Verify for OTP) | Register early — approval gates US delivery |
| Email | **Resend or SendGrid** | Transactional receipts + status updates |
| Images | **Supabase Storage** | Product photos via CDN |
| Monitoring | **Sentry** | Mobile + web + edge functions |

**Scalable path (post-MVP, when one store is outgrown):** dedicated NestJS API + managed Postgres + Redis (slot locking) + S3/CloudFront + a queue for notifications. Not needed for launch.

## 2. System overview

```
   Customer mobile app (Expo)            Admin dashboard (React + Vite)
            │  HTTPS / JWT                          │  HTTPS / JWT
            └──────────────────┬───────────────────┘
                               ▼
                    SUPABASE (backend core)
       Postgres + RLS │ Auth (JWT+roles) │ Storage │ Realtime │ Edge Functions
                               │
        ┌──────────────────────┼───────────────────────────┐
        ▼                      ▼                            ▼
   Edge Functions        pg_cron jobs                 External services
   • create checkout     • generate pickup slots      • Clover (payments;
   • send notifications  • low-stock sweep              optional catalog source)
   • clover webhook      • notification retries       • Twilio (SMS)
   • clover sync/refresh • clover token refresh       • Resend/SendGrid (email)
   • owner-checked
     credential change
```

## 3. Frontend / mobile architecture

- Expo managed workflow; React Navigation; TanStack Query for server state; a thin Supabase client wrapping auth + data calls.
- Screens: auth (login/register/reset), catalog (categories/search/filters), product detail, **scanner** (`CameraView`), cart, pickup-slot picker, checkout (**Clover Hosted Checkout** opened in an in-app browser), order tracking, order history/reorder, profile/favorites.
- The JWT is attached to every request; the app **gates UI by role/permission for UX only** — the database is the real authority.
- No secrets in the bundle. Only the Supabase URL + anon key (public by design) ship to the client. **No Clover token or key is shipped** — the app only receives a Clover-hosted checkout URL from an Edge Function.

## 4. Admin dashboard architecture

- React + Vite SPA, same Supabase backend and auth. Realtime subscriptions drive the live order feed and low-stock alerts.
- Feature modules: Today, Products, Inventory, Pricing, Barcodes, Orders, Customers, Pickup Rules, Notifications (logs + resend), Users & Roles, Reports, Settings.
- Each module's actions map to permission keys (see §7); the UI hides what the role can't do, and every action is still backed by an RLS policy.

## 5. Backend / API architecture

- Primary data access is Supabase's auto-generated, RLS-protected API (PostgREST) directly from the clients.
- **Edge Functions** handle anything that needs server authority or secrets:
  - `clover-create-checkout` — recomputes the order total server-side, creates a Clover Hosted Checkout session, returns the hosted URL (never a key).
  - `clover-payment-webhook` — idempotent on `clover_payment_id`; marks paid, advances the order to `pending`, fires confirmation.
  - `clover-sync-catalog` / `clover-sync-webhook` / `clover-token-refresh` — (if catalog sync is on) one-way Clover→Supabase item/stock sync and OAuth token refresh; service-role only.
  - `send-notification` — sends SMS/email, logs the attempt, records failures.
  - `owner-checked-credential-change` — the only path to change login credentials; re-derives caller role from the DB and enforces Owner protection before using the service role.
- Scheduled work runs via `pg_cron`: nightly pickup-slot generation (respecting prep time + slot caps), low-stock sweep, notification retry.

## 6. Database architecture

- Postgres is the single source of truth. Core tables: `users` (profile + role), `roles`/`permissions`/`role_permissions` (capability catalog), `categories`, `products`, `product_barcodes`, `inventory`, `inventory_logs`, `favorites`, `carts`/`cart_items`, `pickup_orders`/`pickup_order_items`, `pickup_time_slots`, `order_windows`, `pickup_settings`/`system_settings`, `payments`, `notifications`, `audit_logs`. (Full DDL in `DATABASE_SCHEMA.sql`.)
- UUID PKs, `timestamptz` audit columns, price snapshots on order items, numeric money, and indexes on hot lookups (barcode, order status, product search).
- **Inventory integrity:** `quantity_reserved` bumped at checkout; `quantity_on_hand` decremented inside a transaction when an admin accepts; both restored on cancel; every change written to `inventory_logs`.

## 7. Auth system

- Supabase Auth (email/phone + password). JWT carries the user id; the **canonical role** is read from `users.role` server-side via the `auth_user_role()` `SECURITY DEFINER` helper (never trusted from a client-supplied claim for privileged decisions).
- Password reset by email link or SMS OTP (Twilio Verify, exempt from 10DLC).
- Sessions are short-lived + refreshed; the app fails closed on any auth error.

## 8. Role / permission system

- **Canonical role:** `users.role` (`user_role` enum) — security source of truth and the anchor for Owner protection.
- **Fine-grained capabilities:** `role_permissions` maps each role to permission keys (e.g., `products.write`, `orders.update`, `users.manage_below_owner`). Drives feature gating. *Assumption (labeled):* the enum is the hard security layer; the permission catalog is the flexible feature layer, with `roles.key` aligned 1:1 to enum values.
- **Hierarchy (high→low):** Owner (`owner_admin`) → Technology Specialist (`technology_specialist`) → Admin (`admin`) → Manager (`manager`) → Inventory/Order Staff → Staff → Customer → Guest. `developer` is a separate backend identity.

## 9. Notification architecture

- Triggers on order/account state changes enqueue a `notifications` row; the `send-notification` Edge Function delivers via Twilio (SMS) and Resend/SendGrid (email), updates status, and records failures for resend.
- Order-status messages always send; marketing respects opt-in. Email carries receipt-level detail; SMS carries short urgent updates.

## 10. Barcode scanner flow

1. Camera opens (`CameraView`), scans a UPC/EAN.
2. App queries `product_barcodes` by `barcode` (indexed, instant).
3. Hit → product detail (price/stock/size) → add to cart if available. Miss → "product not found."
4. Admin variants additionally: create product from barcode, adjust stock, update price, verify order items, with duplicate-barcode warnings and manual entry.

## 11. Order flow (pickup)

```
Customer builds cart → picks pickup slot → pays via **Clover Hosted Checkout** (in-app browser) → **Clover webhook confirms** → order = pending (stock reserved)
→ admin accepts (stock decremented, txn) → preparing → ready (notify) → customer arrives → completed
                 └→ reject / cancel anytime before completion → stock restored, customer notified (refunds handled in Clover)
```
Each transition writes `audit_logs` / order status history and fires the appropriate notification.

## 12. Inventory update flow

- **Checkout:** reserve quantities (`quantity_reserved += qty`) — guards against overselling the last unit.
- **Accept:** in one transaction, `quantity_on_hand -= qty`, release the reservation, log the change, flip status to low/out as thresholds dictate.
- **Cancel:** restore on-hand and/or reservation, log it.
- **Manual:** admins can adjust with a reason; logged. Barcode scan can drive restock/recount.

## 13. Security model

- **Two layers, always:** RLS in Postgres (hard wall) + UI gating (courtesy). UI gating alone is never sufficient.
- **Owner protection (three independent DB mechanisms):**
  1. RLS `USING` makes `owner_admin` rows untouchable by non-owners.
  2. RLS `WITH CHECK` forbids any insert/update whose result is `owner_admin` (blocks self-promotion).
  3. The `protect_owner_admin` `BEFORE` trigger rejects any non-owner attempt to create/alter/promote-to/demote-from/delete an `owner_admin`, surviving policy misconfiguration.
- **Validation & least privilege:** server-side total recomputation, idempotent webhooks, input validation, fail-closed authorization, audit logging of sensitive actions.
- **Proof:** `test_technology_specialist_rbac.sql` asserts all eleven Owner restrictions and the allowed sub-owner management; it must pass before relying on any app-layer code.

## 14. Deployment model

- Supabase (managed) for DB/auth/storage/functions; Vercel or Netlify for the admin web; EAS for mobile builds + store submission. Sentry across all surfaces.
- Daily automated DB backups + a manual pre-launch export. Forward-only migrations. Staging project mirrors prod.

## 15. Environment variables & secrets rules

| Secret | Where it lives | Never |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function / server runtime env only | in any client bundle, repo, log, dashboard, or a Technology Specialist's hands |
| Clover App secret / Ecommerce API private token / OAuth + refresh + PAKMS tokens | Edge Function secrets + `clover_credentials` (service-role only) | client, admin frontend, repo, logs; **never** readable by Owner or Technology Specialist |
| Twilio auth token, Resend/SendGrid API key | Edge Function env | client, repo, logs |
| Supabase URL + **anon** key | client (public by design) | — (safe to ship) |
| Clover Hosted Checkout **URL** (per session) | returned to client at checkout | — (safe; it is a URL, not a key) |

Rotate keys on staff offboarding. Use per-environment secrets. Read from env at runtime; never hard-code.

## 16. Service-role key & Clover secret warning

> The Supabase `service_role` key (and any backend secret) is **owner-equivalent server power**. It bypasses RLS. It must never be shipped to the mobile app or admin client, committed, logged, surfaced in any UI, or given to a Technology Specialist or any non-owner. It is used only inside server-side Edge Functions, and only **after** an owner-aware authorization check. It is never a shortcut to bypass Owner protection.
>
> The same rule governs **all Clover credentials** — App secret, Ecommerce API private token, OAuth/merchant access + refresh tokens, and the PAKMS key. They live only in Edge Function secrets / the `clover_credentials` table (service-role read only), never in any client, repo, log, or dashboard, and are **never accessible to a Technology Specialist**. The mobile app only ever receives a per-session hosted-checkout URL — never a Clover key or token.

## 17. Owner protection rules (summary)

- Only an `owner_admin` may create, assign, remove, demote, delete, deactivate, or edit the credentials of another `owner_admin`, transfer ownership, change ownership-level permissions, or alter role-hierarchy/security rules.
- Enforced in the database (RLS + trigger), backed by the credential-change Edge Function, and verified by the SQL test suite.

## 18. Technology Specialist limitations (summary)

The Technology Specialist has broad technical + operational reach **below** Owner. It **cannot**: affect any `owner_admin` in any way (assign/remove/demote/delete/deactivate/impersonate/edit credentials), grant itself Owner, transfer ownership, change owner security settings, read service-role keys or backend secrets, **read or use Clover owner-level credentials / OAuth tokens / secret API keys**, or act as database/system owner. Everything it touches at the Owner boundary is a hard, DB-enforced denial — not a hidden button.
