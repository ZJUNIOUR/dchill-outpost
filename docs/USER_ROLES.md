# USER_ROLES.md

Authoritative role and permission reference for DChill Outpost. Aligns 1:1 with
the `user_role` enum, the `roles` / `permissions` / `role_permissions` catalog,
and the RLS policies in `DATABASE_SCHEMA.sql`. If this document and the schema
ever disagree, **the schema + RLS are the source of truth** — fix the doc.

---

## Authority hierarchy

Higher rank = more authority. `rank` is advisory for UI/logic; the hard security
anchor is the `users.role` enum value plus RLS + the `protect_owner_admin`
trigger.

| # | Role | enum / `role_key` | rank | Protected |
|---|------|-------------------|------|-----------|
| 1 | Owner | `owner_admin` | 100 | **Yes** |
| 2 | Technology Specialist | `technology_specialist` | 90 | No |
| 3 | Admin | `admin` | 80 | No |
| 4 | Manager | `manager` | 70 | No |
| 5 | Inventory Staff | `inventory_staff` | 50 | No |
| 5 | Order Staff | `order_staff` | 50 | No |
| 6 | Staff | `staff` | 40 | No |
| 7 | Customer | `customer` | 10 | No |
| 8 | Guest | `guest` | 0 | No |
| — | Developer / System | `developer` | −1 | No (backend infra identity, not store hierarchy) |

**Core rule:** only an `owner_admin` may create, edit, demote, deactivate,
delete, or otherwise affect another `owner_admin`. No other role — including
Technology Specialist and Admin — can touch the Owner. No role may escalate
itself or assign a role above its own rank.

---

## Permission catalog (keys used in `role_permissions`)

`catalog.browse`, `products.read`, `products.write`, `inventory.read`,
`inventory.write`, `prices.write`, `barcodes.manage`, `orders.read_own`,
`orders.read_all`, `orders.update`, `orders.cancel`, `customers.manage`,
`pickup.rules_manage`, `notifications.read`, `notifications.resend`,
`reports.view`, `settings.basic`, `settings.system`, `users.manage_below_owner`,
`roles.assign_below_owner`, `maintenance.tools`, `testing.tools`,
`db.troubleshoot_scoped`, and the owner-only `owner.protected`
(transfer ownership, change owner security, modify role hierarchy).

`owner.protected` is flagged `owner_only = TRUE`; the `protect_owner_permission`
trigger blocks it from ever being attached to any role except `owner_admin`.

### Role → permission matrix

| Permission | Guest | Customer | Staff | Order Staff | Inv. Staff | Manager | Admin | Tech Spec | Owner |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| catalog.browse | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| orders.read_own | — | ✅ | — | — | — | ✅ | ✅ | ✅ | ✅ |
| products.read | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| inventory.read | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| orders.read_all | — | — | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ |
| orders.update | — | — | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ |
| orders.cancel | — | — | — | ✅ | — | ✅ | ✅ | ✅ | ✅ |
| barcodes.manage | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| products.write | — | — | — | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| inventory.write | — | — | — | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| prices.write | — | — | — | — | ✅ | ✅ | ✅ | ✅ | ✅ |
| customers.manage | — | — | — | — | — | ✅ | ✅ | ✅ | ✅ |
| pickup.rules_manage | — | — | — | — | — | ✅ | ✅ | ✅ | ✅ |
| notifications.read | — | — | — | — | — | ✅ | ✅ | ✅ | ✅ |
| notifications.resend | — | — | — | — | — | ✅ | ✅ | ✅ | ✅ |
| reports.view | — | — | — | — | — | ✅ | ✅ | ✅ | ✅ |
| settings.basic | — | — | — | — | — | ✅ | ✅ | ✅ | ✅ |
| users.manage_below_owner | — | — | — | — | — | ✅ | ✅ | ✅ | ✅ |
| roles.assign_below_owner | — | — | — | — | — | ✅ | ✅ | ✅ | ✅ |
| settings.system | — | — | — | — | — | — | — | ✅ | ✅ |
| maintenance.tools | — | — | — | — | — | — | — | ✅ | ✅ |
| testing.tools | — | — | — | — | — | — | — | ✅ | ✅ |
| db.troubleshoot_scoped | — | — | — | — | — | — | — | ✅ | ✅ |
| **owner.protected** | — | — | — | — | — | — | — | **❌** | ✅ |

> The seed grants `admin` the manager permission set by default (tune as the
> store wishes); `technology_specialist` receives **every** non-owner-only
> permission; `owner_admin` receives all, including `owner.protected`.

---

## Role detail

### 1. Owner — `owner_admin` (rank 100, protected)
- **Description:** The single highest authority and the business owner. The only
  role that can affect another Owner. Holds ownership-level controls.
- **Allowed actions:** Everything — all operational tools, all user/role
  management at every level, all settings (basic + system + ownership),
  ownership transfer, owner security settings, and modifying role hierarchy.
- **Restricted actions:** None functionally; bound only by good practice and
  audit logging.
- **Admin dashboard access:** Full, including the owner-only settings area.
- **Database/security access:** Highest application-layer authority. Even so,
  the Owner is **not** the Postgres/database owner and does **not** hold the
  service-role key — those are server/infra concerns. Owner power is exercised
  through the app/Edge Functions, all audited.
- **Special rules:** Protected at the DB layer (RLS `USING`/`WITH CHECK` + the
  `protect_owner_admin` trigger). There should be a deliberate, minimal number
  of Owner accounts. Creating/transferring Owner is a manual, audited operation.

### 2. Technology Specialist — `technology_specialist` (rank 90)
- **Description:** Powerful technical + operational role. Maintains the app,
  troubleshoots, manages configuration, tests/debugs, supports staff, reviews
  logs, runs all product/inventory/order tooling, and administers all users
  **below** Owner. Sits directly below Owner and above Admin.
- **Allowed actions:** Every non-owner-only permission — full product, inventory,
  pricing, barcode, order, customer-support, pickup-rules, notification (incl.
  resend), reports, **basic and system settings**, maintenance/testing/debug
  tools, scoped DB troubleshooting, and creating/editing/activating/
  deactivating users and assigning/removing roles **below** Owner.
- **Restricted actions (hard, DB-enforced):** Cannot assign, remove, create,
  demote, delete, deactivate, edit, or impersonate an Owner; cannot edit an
  Owner's email/phone/password/credentials; cannot transfer ownership; cannot
  change ownership-level permissions; cannot modify role-hierarchy/security
  rules; cannot grant itself Owner; cannot hold `owner.protected`; cannot read
  service-role keys or backend secrets; is not the DB/system owner.
- **Admin dashboard access:** Full operational surface + maintenance/testing/
  debug panels. The owner-only settings area is hidden **and** server-blocked.
- **Database/security access:** Broad operational access via RLS-governed app
  paths and scoped, read-mostly troubleshooting. **No** service-role key, **no**
  RLS-bypass, **no** ability to alter policies/triggers.
- **Special rules:** All restrictions are enforced by RLS + the
  `protect_owner_admin` trigger and proven by
  `test_technology_specialist_rbac.sql`, which must stay green.

### 3. Admin — `admin` (rank 80)
- **Description:** Senior operational administrator for day-to-day store
  administration, below Technology Specialist.
- **Allowed actions:** Default = the Manager permission set (orders, inventory,
  products, pricing, barcodes, customers, pickup rules, notifications, reports,
  basic settings, user management below Owner). Tunable by the Owner.
- **Restricted actions:** No system settings, maintenance/testing/DB tools (those
  are Tech Specialist/Owner), and — like everyone below Owner — cannot affect an
  Owner, cannot escalate to Owner, cannot hold `owner.protected`.
- **Admin dashboard access:** Full operational surface; no owner-only area; no
  maintenance/debug panels by default.
- **Database/security access:** App-layer operational only via RLS. No secrets.
- **Special rules:** May manage users/roles below Owner (and not above its own
  rank). Cannot manage Technology Specialist accounts (higher rank).

### 4. Manager — `manager` (rank 70)
- **Description:** Store operations lead.
- **Allowed actions:** Orders (read all, update, cancel), inventory + products +
  prices + barcodes, customer management/support, pickup rules & slots,
  notification logs + resend, reports, basic settings, and user management for
  roles below Owner (practically: staff/order_staff/inventory_staff/customer).
- **Restricted actions:** No system settings, maintenance/testing/DB tools; no
  Owner impact; cannot manage Admin/Tech Specialist (higher rank).
- **Admin dashboard access:** Full operational surface; no owner-only area.
- **Database/security access:** App-layer operational via RLS. No secrets.
- **Special rules:** Cannot assign a role above its own rank.

### 5a. Inventory Staff — `inventory_staff` (rank 50)
- **Description:** Stock and catalog specialist.
- **Allowed actions:** Read catalog; read/write products; read/write inventory;
  change prices; manage barcodes.
- **Restricted actions:** No order management beyond reading the catalog; no
  customer management, pickup rules, reports, settings, or user management.
- **Admin dashboard access:** Inventory/product/pricing/barcode sections only.
- **Database/security access:** Scoped writes to products/inventory via RLS.
- **Special rules:** None beyond scope.

### 5b. Order Staff — `order_staff` (rank 50)
- **Description:** Pickup-order fulfillment specialist.
- **Allowed actions:** Read catalog/products/inventory; read all orders; update
  order status/items/substitutions; cancel orders; manage barcodes (scan to
  confirm items during prep).
- **Restricted actions:** No product/inventory/price writes; no customer mgmt,
  pickup rules, reports, settings, or user management.
- **Admin dashboard access:** Order queue + prep tools.
- **Database/security access:** Scoped order writes via RLS.
- **Special rules:** None beyond scope.

### 6. Staff — `staff` (rank 40)
- **Description:** General floor/cashier staff.
- **Allowed actions:** Read catalog/products/inventory; read all orders; update
  order status; manage barcodes (scan/lookup).
- **Restricted actions:** No cancels, no writes to products/inventory/prices, no
  customer mgmt, pickup rules, reports, settings, or user management.
- **Admin dashboard access:** Read-mostly operational view + order status updates.
- **Database/security access:** Minimal scoped writes via RLS.
- **Special rules:** None.

### 7. Customer — `customer` (rank 10)
- **Description:** Registered shopper using the mobile app.
- **Allowed actions:** Browse catalog/prices/stock; scan barcodes; favorite
  items; build a cart; place pickup orders; read **own** orders; reorder;
  manage own profile and saved (account-use) addresses.
- **Restricted actions:** No access to other customers' data, any admin surface,
  or any management capability. RLS restricts reads/writes to their own rows.
- **Admin dashboard access:** None.
- **Database/security access:** Own rows only (orders, cart, favorites, profile).
- **Special rules:** Order-status and pickup-ready messages always send; only
  marketing messages respect opt-out.

### 8. Guest — `guest` (rank 0)
- **Description:** Unauthenticated visitor. Usually **no** `users` row exists;
  represented conceptually for browse-before-signup.
- **Allowed actions:** Browse public catalog/prices/stock only.
- **Restricted actions:** Cannot place orders, favorite, scan-to-cart, or see any
  account/admin data. Must register (become `customer`) to order.
- **Admin dashboard access:** None.
- **Database/security access:** Public read of catalog only (via anon role RLS).
- **Special rules:** Treat as least privilege; never expose write paths.

### Developer / System — `developer` (rank −1, backend infra)
- Not part of the store-facing hierarchy. A backend/infra maintenance identity
  with maintenance/testing/scoped-DB-troubleshooting permissions only. Holds **no**
  Owner power and is **not** the route for the service-role key (that remains a
  server runtime secret). Use sparingly; audit its actions.

---

## Enforcement summary

- **Hard anchor:** `users.role` enum + RLS + the `protect_owner_admin` trigger
  (owner protection, anti-self-escalation, no assigning above own rank).
- **Owner-only permissions:** the `protect_owner_permission` trigger keeps
  `owner.protected` attachable to `owner_admin` only.
- **Feature gating:** apps read `role_permissions` to show/hide UI — but every
  sensitive action is independently enforced server-side.
- **Secrets:** the service-role key is server-only and is never owner-, admin-,
  or technology-specialist-accessible.
- **Proof:** `test_technology_specialist_rbac.sql` asserts the Technology
  Specialist boundary at the database level and must pass on every change.
