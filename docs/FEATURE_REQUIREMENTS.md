# FEATURE_REQUIREMENTS.md

Detailed feature requirements for the DChill Outpost **pickup-only** MVP. Each
feature lists a description, a user story, acceptance criteria, a priority, and
notes. Priorities: **P0** = MVP must-have, **P1** = fast follow (post-launch),
**P2** = future phase. Delivery is **P2** and never P0.

Conventions: "elevated roles" = manager / admin / technology_specialist / owner;
all sensitive actions are enforced server-side via RLS + Edge Functions, never by
UI gating alone.

---

## 1. Login / Auth features

### 1.1 Account creation (P0)
- **Description:** Customer signs up with name, phone, email, password.
- **User story:** As a shopper, I want to create an account so I can place pickup orders.
- **Acceptance criteria:** Valid email/phone required; duplicate email/phone rejected; password meets policy; row created with role `customer`; confirmation email sent (SMS when 10DLC live).
- **Notes:** Account creation goes through Supabase Auth; `users` profile row mirrors auth identity.

### 1.2 Login (P0)
- **Description:** Secure login by email/phone + password; JWT carries role.
- **User story:** As a user, I want to log in securely.
- **Acceptance criteria:** Correct credentials authenticate; wrong credentials fail without leaking which field; session/JWT issued; role resolved from `users.role`.
- **Notes:** Lockout/rate-limit on repeated failures (P1 if not trivial).

### 1.3 Forgot/reset password (P0)
- **Description:** Reset via email link or SMS code.
- **User story:** As a user, I want to reset a forgotten password.
- **Acceptance criteria:** Reset link/code delivered; expires; password updated; confirmation sent.
- **Notes:** Use Twilio Verify for OTP (exempt from 10DLC).

### 1.4 Profile management (P0)
- **Description:** Update own name, email, phone, saved (account-use) addresses.
- **User story:** As a customer, I want to keep my contact info current.
- **Acceptance criteria:** Own profile editable; cannot view/edit others; addresses are account-use only (not delivery).
- **Notes:** Owner credential changes route through `owner-checked-credential-change` Edge Function.

---

## 2. Customer app features

### 2.1 Browse by category (P0)
- **Description:** Browse meats, drinks, seasonings, snacks, frozen, produce, household, Caribbean goods.
- **User story:** As a shopper, I want to browse categories to find items.
- **Acceptance criteria:** Categories list; tapping shows in-stock-aware products; hidden/admin-only items never shown to customers.
- **Notes:** Caribbean specialty items are first-class in naming/categories.

### 2.2 Search (P0)
- **Description:** Search by name, brand, category, barcode, keyword.
- **User story:** As a shopper, I want to search to find a product fast.
- **Acceptance criteria:** Full-text + barcode lookup returns relevant results quickly; empty-state handled.
- **Notes:** Caribbean-name synonyms are P1.

### 2.3 Product detail + stock status (P0)
- **Description:** Image, name, price, description, size, brand, availability.
- **User story:** As a shopper, I want product details and whether it's in stock.
- **Acceptance criteria:** Shows in stock / low stock / out of stock; out-of-stock cannot be added to cart.
- **Notes:** Price reflects sale price when set.

### 2.4 Filters & favorites (P0)
- **Description:** Filter by category/price/brand/availability; favorite items.
- **User story:** As a frequent shopper, I want to save items I buy often.
- **Acceptance criteria:** Filters narrow results; favorites persist per customer and are private to them.

### 2.5 Featured / weekly deals (P0)
- **Description:** Promoted products, new arrivals, deals, Caribbean specialties.
- **User story:** As a shopper, I want to see what's featured.
- **Acceptance criteria:** Featured flag surfaces items; admin-controlled.

### 2.6 Reorder (P1)
- **Description:** Re-add items from a past order to the cart.
- **User story:** As a returning customer, I want to reorder quickly.
- **Acceptance criteria:** Past order items added to cart, respecting current stock/price.

---

## 3. Barcode scanner features

### 3.1 Customer scan-to-find (P0)
- **Description:** Camera scan resolves a product; add to cart if available.
- **User story:** As a shopper, I want to scan a barcode to find/add an item.
- **Acceptance criteria:** Scan returns matching product instantly; "Product not found" shown when no match; manual entry fallback; retry on failed scan.
- **Notes:** Uses `expo-camera` `CameraView` (`onBarcodeScanned`); `expo-barcode-scanner` is deprecated.

### 3.2 Admin scan tools (P0)
- **Description:** Lookup, add-product-by-barcode, restock, reprice, confirm-during-prep, duplicate-warning.
- **User story:** As inventory/order staff, I want to scan to manage stock and confirm items.
- **Acceptance criteria:** Scan pulls product instantly; new product can be created from a scan; restock/reprice update inventory/price with a log entry; duplicate barcode warns; multi-barcode supported; one barcode → one product.
- **Notes:** Requires `barcodes.manage` (+ `inventory.write`/`prices.write` for those actions).

---

## 4. Inventory features

### 4.1 Product management (P0)
- **Description:** Create/edit/hide products with name, image, category, brand, description, size/unit, SKU, barcode(s), price, sale price, taxable, featured, substitution-allowed.
- **User story:** As inventory staff, I want to manage the catalog.
- **Acceptance criteria:** CRUD works; hidden products vanish from customer app; requires `products.write`.

### 4.2 Stock levels & statuses (P0)
- **Description:** Track on-hand/reserved; statuses in stock / low / out / hidden / admin-only.
- **User story:** As staff, I want accurate stock so customers don't order unavailable items.
- **Acceptance criteria:** Out-of-stock locks ordering; low-stock threshold configurable; status reflects quantity.

### 4.3 Inventory transactions & logs (P0)
- **Description:** Reserve on checkout, decrement on admin **accept**, restore on cancel; every change logged with who/when/why.
- **User story:** As an owner, I want an auditable stock trail.
- **Acceptance criteria:** Transaction is atomic; no oversell of the last unit; `inventory_logs`/`audit_logs` entry per change; manual override allowed for elevated roles.

### 4.4 Low-stock alerts (P0)
- **Description:** Flag items below threshold to admins.
- **User story:** As a manager, I want to be alerted to restock.
- **Acceptance criteria:** Dashboard alert when below threshold; optional email.

---

## 5. Pickup ordering features

### 5.1 Cart (P0)
- **Description:** Add/edit/remove items; see subtotal and estimated tax.
- **User story:** As a customer, I want to build and review my order.
- **Acceptance criteria:** Quantities editable; out-of-stock blocked; subtotal/tax shown before checkout.

### 5.2 Pickup time-slot selection (P0)
- **Description:** Choose from admin-controlled time slots respecting prep time and per-slot caps.
- **User story:** As a customer, I want to pick a pickup time that's actually available.
- **Acceptance criteria:** Slots too soon (within prep time) are blocked; full slots unavailable; selection stored on the order.
- **Notes:** Slots generated nightly from `order_windows` + `system_settings`.

### 5.3 Order notes & submit (P0)
- **Description:** Add substitution/pickup notes; submit for fulfillment.
- **User story:** As a customer, I want to leave instructions and place my order.
- **Acceptance criteria:** Notes saved; order created with status `pending`; confirmation sent.

### 5.4 Payment at checkout (P0 — labeled assumption)
- **Description:** In-app payment via **Clover Hosted Checkout** at checkout (default mode).
- **User story:** As a customer, I want to pay securely in the app.
- **Acceptance criteria:** An Edge Function creates the Clover checkout session server-side (recomputing the total); the app opens the hosted URL in an in-app browser; **card data never touches the app or our servers** (Clover handles it); a **Clover webhook** confirms payment (idempotent on `clover_payment_id`) and the order proceeds only on `paid`; success/failure/incomplete redirects handled; no Clover token/key is ever sent to the client.
- **Notes:** **Assumption:** in-app pay-at-checkout via Clover. Pay-at-pickup is a separate, configurable mode (`system_settings.payment_model`; see `MEMORY.md`); do not silently mix them. Refunds/voids are handled in the Clover Dashboard at MVP (Hosted Checkout doesn't expose them).

### 5.5 Order tracking (P0)
- **Description:** Track status received → accepted → preparing → ready → completed (or canceled).
- **User story:** As a customer, I want to know my order's status.
- **Acceptance criteria:** Live status visible; status changes notify the customer.

### 5.6 Admin order management (P0)
- **Description:** Realtime queue; accept/reject, update status, edit items, mark unavailable, substitute, contact customer, mark ready, complete, cancel (with reason).
- **User story:** As order staff, I want to run an order end to end.
- **Acceptance criteria:** Accept decrements stock; cancel restores it; substitutions require `substitution_allowed`; every transition logged; customer notified.

---

## 6. SMS / email notification features

### 6.1 Transactional notifications (P0)
- **Description:** Account created, password reset, order placed/accepted/preparing, item unavailable, substitution, ready for pickup, completed, canceled.
- **User story:** As a customer, I want timely updates by SMS and email.
- **Acceptance criteria:** Email live at launch; SMS code-complete and live on 10DLC approval; each send logged.

### 6.2 Admin notifications (P0)
- **Description:** New order, customer cancel, low stock, customer note, failed send.
- **User story:** As staff, I want to be alerted to things needing action.
- **Acceptance criteria:** Dashboard alerts fire; optional email for low stock.

### 6.3 Logs, resend, opt-out (P0)
- **Description:** Notification log; admin resend of failed/needed messages; marketing opt-out.
- **User story:** As a manager, I want to see/resend messages and respect opt-outs.
- **Acceptance criteria:** Failed sends tracked; resend works; **order/pickup messages always send**; only marketing respects opt-out; requires `notifications.read`/`notifications.resend`.

---

## 7. Role management features

### 7.1 User administration below Owner (P0)
- **Description:** Create/edit/activate/deactivate users and assign/remove roles **below** Owner.
- **User story:** As an admin/tech specialist/manager, I want to manage staff accounts.
- **Acceptance criteria:** Actor can manage only roles at/below its rank and never `owner_admin`; cannot assign a role above its own rank; cannot self-escalate; enforced by RLS + `protect_owner_admin` trigger.
- **Notes:** Requires `users.manage_below_owner` + `roles.assign_below_owner`.

### 7.2 Owner protection (P0)
- **Description:** Only an Owner can affect an Owner; ownership transfer and owner security are owner-only.
- **User story:** As the Owner, I want my account and ownership controls protected from everyone else.
- **Acceptance criteria:** Every Owner-affecting action by a non-owner is blocked at the DB layer; `owner.protected` permission attachable to `owner_admin` only; proven by `test_technology_specialist_rbac.sql`.

### 7.3 Owner-checked credential changes (P0)
- **Description:** Email/phone/password changes for any user go through an Edge Function that re-derives caller + target role from the DB.
- **User story:** As the system, I must ensure only an Owner can change an Owner's credentials.
- **Acceptance criteria:** Target Owner → only Owner caller; target below Owner → owner/tech-specialist caller; service-role key server-only; no role change via this path.

---

## 8. Reporting features

### 8.1 Operational reports (P0)
- **Description:** Orders, popular products, low stock, sales trends, daily activity.
- **User story:** As a manager/owner, I want to see how the store is doing.
- **Acceptance criteria:** Today's orders/pending/completed/low-stock/sales visible; requires `reports.view`.

### 8.2 Advanced analytics (P2)
- **Description:** Forecasting, customer behavior, top products over time.
- **Notes:** Future phase.

---

## 9. Settings features

### 9.1 Basic store settings (P0)
- **Description:** Store hours/order windows, prep time, slot caps, low-stock thresholds, tax rate, notification config.
- **User story:** As a manager/admin, I want to configure store operations.
- **Acceptance criteria:** Editable with `settings.basic`; changes audited.

### 9.2 System settings (P0, restricted)
- **Description:** System-level configuration (`settings.system`).
- **Acceptance criteria:** Editable only by technology_specialist/owner.

### 9.3 Owner-protected settings (P0, owner-only)
- **Description:** Ownership transfer, owner security, role-hierarchy rules.
- **Acceptance criteria:** `owner.protected`; owner-only; hidden **and** server-blocked for all others.

---

## 10. Security / audit features

### 10.1 Audit logging (P0)
- **Description:** Append-only log of sensitive actions (role changes, settings changes, credential changes, cancels, overrides) without secrets.
- **User story:** As an owner, I want an immutable record of sensitive actions.
- **Acceptance criteria:** `audit_logs` has no UPDATE/DELETE policy; entries carry actor/target/action/time, never secrets/plaintext credentials.

### 10.2 Row Level Security everywhere (P0)
- **Description:** RLS on all sensitive tables; least privilege by default.
- **Acceptance criteria:** Customers see only own rows; staff scopes enforced; elevated roles bounded by rank; Owner protected.

### 10.3 Secret hygiene (P0)
- **Description:** Service-role/backend secrets **and all Clover credentials** are server-only.
- **Acceptance criteria:** No secret in any client bundle, committed file, log, response, or dashboard; never accessible to a Technology Specialist. Clover App secret, Ecommerce API token, OAuth/merchant access + refresh tokens, and PAKMS key live only in Edge Function secrets / `clover_credentials` (service-role read only). The app receives only a per-session hosted-checkout URL.

### 10.4 Clover payment integration (P0)
- **Description:** All Clover API calls happen server-side via Edge Functions; payments confirmed by webhook.
- **User story:** As the business, I want Clover payments that are secure and reconcilable.
- **Acceptance criteria:** `clover-create-checkout` recomputes totals server-side; `clover-payment-webhook` is idempotent on `clover_payment_id`; missed webhooks recovered by a reconciliation poll; `payments` rows link to the order via `clover_checkout_session_id`/`clover_payment_id`.

### 10.5 Clover catalog/inventory sync (P1 — optional, one-way)
- **Description:** If the store manages products in Clover, mirror items/SKUs/barcodes/prices/stock **one-way** Clover→Supabase.
- **User story:** As an admin, I want the app catalog to match what we keep in Clover.
- **Acceptance criteria:** Initial import + webhook + scheduled delta poll upsert by `clover_item_id`; Clover wins catalog fields, Supabase owns app-only fields (featured, favorites, pickup availability); drift flagged via `clover_sync_status`; no stock write-back at MVP. Set `clover_sync_mode='payments_only'` to disable when products aren't in Clover.

---

## Out of MVP (future phases)
Delivery and driver logic (**P2**), loyalty/points (**P1/P2**), coupons/promo
codes (**P1/P2**), push notifications (**P1**), advanced analytics (**P2**),
vendor/supplier ordering (**P2**), web ordering (**P2**), multi-location (**P2**).
