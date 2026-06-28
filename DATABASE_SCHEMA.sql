-- =====================================================================
--  DChill Outpost — DATABASE_SCHEMA.sql
--  PostgreSQL / Supabase. Pickup-only MVP. Owner-protected RBAC.
--
--  Apply order: extensions -> enums -> helper -> tables -> indexes ->
--  RLS + Owner-protection -> seed data. Idempotent where practical.
--
--  SECURITY ANCHORS (do not rename/remove without owner sign-off):
--    enum value  user_role.'owner_admin'      = the Owner (highest, protected)
--    enum value  user_role.'technology_specialist' = powerful, below Owner
--    function    auth_user_role()             = caller's role, RLS-safe
--    function    protect_owner_admin()        = Owner guard trigger
--    trigger     trg_protect_owner_admin
--    policies    users_owner_all, users_ts_*
--  The test suite test_technology_specialist_rbac.sql depends on these names.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
    'guest','customer','staff','order_staff','inventory_staff',
    'manager','admin','technology_specialist','owner_admin','developer'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Listed low->high authority for readability only. Authorization NEVER relies on
-- enum ordinal position; it uses explicit role lists / role_permissions / the
-- auth_user_role() helper. 'owner_admin' = Owner. 'developer' = backend infra
-- identity, not part of the store-facing operational hierarchy.

DO $$ BEGIN CREATE TYPE product_status AS ENUM
  ('in_stock','low_stock','out_of_stock','hidden','admin_only');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE order_status AS ENUM
  ('pending','accepted','preparing','ready','completed','canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;   -- pickup lifecycle; no delivery states

DO $$ BEGIN CREATE TYPE payment_status AS ENUM
  ('unpaid','paid','refunded','canceled','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE order_item_status AS ENUM
  ('ok','unavailable','substituted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE notif_channel AS ENUM ('sms','email','push');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE notif_status AS ENUM ('queued','sent','failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- HELPER: caller's app role, bypassing RLS to avoid recursion in users
-- policies. SECURITY DEFINER + locked search_path (Supabase-safe pattern).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth_user_role()
RETURNS user_role
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;

-- =====================================================================
-- USERS / PROFILES
-- On Supabase, users.id maps to auth.users.id. Credentials (password,
-- verified email/phone for login) live in auth.users and are changed ONLY
-- via the owner-checked Edge Function — never directly by clients.
-- =====================================================================
CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            TEXT UNIQUE,
  phone            TEXT UNIQUE,
  full_name        TEXT NOT NULL,
  role             user_role NOT NULL DEFAULT 'customer',
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  marketing_opt_in BOOLEAN NOT NULL DEFAULT FALSE,  -- order updates ignore this; marketing respects it
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS addresses (   -- account-use only; NOT delivery (pickup-only MVP)
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label       TEXT,
  line1       TEXT NOT NULL,
  line2       TEXT,
  city        TEXT NOT NULL,
  state       TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- RBAC CATALOG: roles / permissions / role_permissions
-- Fine-grained capability layer. roles.key aligns 1:1 with user_role enum.
-- The enum on users.role is the hard security anchor; this catalog drives
-- feature gating in the apps.
-- =====================================================================
CREATE TABLE IF NOT EXISTS roles (
  key         user_role PRIMARY KEY,           -- same identifier space as the enum
  name        TEXT NOT NULL,
  rank        INT  NOT NULL,                    -- higher = more authority (advisory)
  is_protected BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE only for owner_admin
  description TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  key         TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  owner_only  BOOLEAN NOT NULL DEFAULT FALSE    -- TRUE = ownership-level, never granted to non-owner
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_key       user_role NOT NULL REFERENCES roles(key) ON DELETE CASCADE,
  permission_key TEXT      NOT NULL REFERENCES permissions(key) ON DELETE CASCADE,
  PRIMARY KEY (role_key, permission_key)
);

-- Guard: an owner-only permission may be attached to no role but owner_admin.
-- Prevents anyone from granting ownership-level power to TS/admin/etc via data.
CREATE OR REPLACE FUNCTION protect_owner_permission()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM permissions p WHERE p.key = NEW.permission_key AND p.owner_only)
     AND NEW.role_key <> 'owner_admin' THEN
    RAISE EXCEPTION 'Forbidden: owner-only permission "%" cannot be granted to role "%"',
      NEW.permission_key, NEW.role_key;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_protect_owner_permission ON role_permissions;
CREATE TRIGGER trg_protect_owner_permission
  BEFORE INSERT OR UPDATE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION protect_owner_permission();

-- =====================================================================
-- CATALOG: categories / products / barcodes
-- =====================================================================
CREATE TABLE IF NOT EXISTS categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  slug       TEXT UNIQUE NOT NULL,
  parent_id  UUID REFERENCES categories(id),
  sort_order INT  NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS products (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT NOT NULL,
  slug                 TEXT UNIQUE NOT NULL,
  category_id          UUID REFERENCES categories(id),
  brand                TEXT,
  sku                  TEXT UNIQUE,
  description          TEXT,
  size_unit            TEXT,                              -- '12 oz', '5 lb', 'each', 'case'
  image_url            TEXT,
  base_price           NUMERIC(10,2) NOT NULL CHECK (base_price >= 0),
  sale_price           NUMERIC(10,2) CHECK (sale_price IS NULL OR sale_price >= 0),
  is_taxable           BOOLEAN NOT NULL DEFAULT TRUE,
  is_featured          BOOLEAN NOT NULL DEFAULT FALSE,
  substitution_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  status               product_status NOT NULL DEFAULT 'in_stock',
  clover_item_id       TEXT UNIQUE,                        -- Clover inventory item id (when synced from Clover)
  clover_sync_status   TEXT NOT NULL DEFAULT 'local_only', -- local_only | synced | pending | error | conflict
  last_synced_at       TIMESTAMPTZ,                        -- last successful Clover->Supabase sync
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sale_le_base CHECK (sale_price IS NULL OR sale_price <= base_price)
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_status   ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_clover   ON products(clover_item_id);
CREATE INDEX IF NOT EXISTS idx_products_search   ON products
  USING GIN (to_tsvector('english', coalesce(name,'')||' '||coalesce(brand,'')||' '||coalesce(description,'')));

CREATE TABLE IF NOT EXISTS product_barcodes (        -- barcode fields; a product may have several
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  barcode    TEXT UNIQUE NOT NULL,                   -- one barcode -> one product (UPC/EAN)
  is_primary BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_barcode_lookup ON product_barcodes(barcode);

-- =====================================================================
-- INVENTORY
-- =====================================================================
CREATE TABLE IF NOT EXISTS inventory (
  product_id          UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  quantity_on_hand    INT NOT NULL DEFAULT 0 CHECK (quantity_on_hand  >= 0),
  quantity_reserved   INT NOT NULL DEFAULT 0 CHECK (quantity_reserved >= 0),
  low_stock_threshold INT NOT NULL DEFAULT 5,
  clover_sync_status  TEXT NOT NULL DEFAULT 'local_only', -- local_only | synced | pending | error
  last_synced_at      TIMESTAMPTZ,                        -- last reconciliation against Clover item stock
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);  -- available = quantity_on_hand - quantity_reserved

CREATE TABLE IF NOT EXISTS inventory_logs (          -- every stock change, who/when/why
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id   UUID NOT NULL REFERENCES products(id),
  change_qty   INT  NOT NULL,
  new_quantity INT  NOT NULL,
  reason       TEXT NOT NULL,                         -- order_accepted | order_canceled | manual | restock
  user_id      UUID REFERENCES users(id),
  order_id     UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS favorites (
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (customer_id, product_id)
);

-- =====================================================================
-- CART
-- =====================================================================
CREATE TABLE IF NOT EXISTS carts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'active',          -- active | converted | abandoned
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cart_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id             UUID NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
  product_id          UUID NOT NULL REFERENCES products(id),
  quantity            INT NOT NULL CHECK (quantity > 0),
  unit_price_snapshot NUMERIC(10,2) NOT NULL,
  UNIQUE (cart_id, product_id)
);

-- =====================================================================
-- PICKUP RULES, SLOTS, SETTINGS
-- =====================================================================
CREATE TABLE IF NOT EXISTS system_settings (           -- single-row store config (id = TRUE)
  id                  BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  store_name          TEXT NOT NULL DEFAULT 'DChill Outpost',
  tax_rate            NUMERIC(5,4) NOT NULL DEFAULT 0.0675,  -- confirm Nash County, NC combined rate
  min_prep_minutes    INT NOT NULL DEFAULT 45,
  min_order_amount    NUMERIC(10,2) DEFAULT 0,
  max_orders_per_slot INT NOT NULL DEFAULT 6,
  same_day_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  delivery_enabled    BOOLEAN NOT NULL DEFAULT FALSE,        -- FUTURE-READY BUT DISABLED at launch (both apps)
  -- payment_model is a deliberate, separable decision (see MEMORY.md):
  payment_model       TEXT NOT NULL DEFAULT 'in_app_checkout'  -- 'in_app_checkout' | 'pay_at_pickup'
                       CHECK (payment_model IN ('in_app_checkout','pay_at_pickup')),
  payment_provider    TEXT NOT NULL DEFAULT 'clover',         -- Clover is the processor
  clover_merchant_id  TEXT,                                   -- non-secret merchant identifier (mId)
  clover_sync_mode    TEXT NOT NULL DEFAULT 'payments_only'   -- 'payments_only' (A) | 'catalog_oneway' | 'full' (B, future)
                       CHECK (clover_sync_mode IN ('payments_only','catalog_oneway','full')),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- CLOVER CREDENTIALS (SERVER-ONLY — never readable by ANY app role).
-- Holds per-merchant OAuth tokens / PAKMS key for server-side Edge Functions.
-- App ID/secret and the Ecommerce API private token live in Edge Function
-- SECRETS, not here. RLS is enabled with NO policies => only the Supabase
-- service role (Edge Functions) can read it. Owner and Technology Specialist
-- get ZERO rows. A Technology Specialist can never reach Clover secrets.
-- =====================================================================
CREATE TABLE IF NOT EXISTS clover_credentials (
  merchant_id       TEXT PRIMARY KEY,        -- Clover mId
  access_token_enc  BYTEA,                   -- encrypted OAuth/merchant access token
  refresh_token_enc BYTEA,                   -- encrypted refresh token (OAuth)
  pakms_key_enc     BYTEA,                   -- encrypted PAKMS key (Ecommerce API), if used
  token_expires_at  TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE clover_credentials ENABLE ROW LEVEL SECURITY;  -- no policies => service-role only

CREATE TABLE IF NOT EXISTS order_windows (             -- recurring weekday order/pickup hours
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day_of_week  INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=Sun
  order_open   TIME,
  order_close  TIME,
  pickup_open  TIME,
  pickup_close TIME,
  is_open      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS pickup_time_slots (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_date    DATE NOT NULL,
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  max_orders   INT  NOT NULL DEFAULT 6,
  orders_count INT  NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (slot_date, start_time)
);
CREATE INDEX IF NOT EXISTS idx_slots_date ON pickup_time_slots(slot_date) WHERE is_active;

-- =====================================================================
-- ORDERS (pickup only)
-- =====================================================================
CREATE TABLE IF NOT EXISTS pickup_orders (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number   TEXT UNIQUE NOT NULL,                  -- human-friendly, e.g. DC-100245
  customer_id    UUID NOT NULL REFERENCES users(id),
  status         order_status NOT NULL DEFAULT 'pending',
  subtotal       NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax            NUMERIC(10,2) NOT NULL DEFAULT 0,
  total          NUMERIC(10,2) NOT NULL DEFAULT 0,      -- subtotal + tax
  payment_method TEXT NOT NULL DEFAULT 'clover',
  payment_status payment_status NOT NULL DEFAULT 'unpaid',
  pickup_slot_id UUID NOT NULL REFERENCES pickup_time_slots(id),  -- every order is a pickup
  clover_order_id    TEXT,        -- set only if an order is mirrored into Clover (approach B, future)
  clover_sync_status TEXT NOT NULL DEFAULT 'not_synced',  -- not_synced | synced | error (B-only)
  customer_notes TEXT,
  admin_notes    TEXT,
  canceled_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON pickup_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status   ON pickup_orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created  ON pickup_orders(created_at DESC);

CREATE TABLE IF NOT EXISTS pickup_order_items (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id               UUID NOT NULL REFERENCES pickup_orders(id) ON DELETE CASCADE,
  product_id             UUID NOT NULL REFERENCES products(id),
  name_snapshot          TEXT NOT NULL,                 -- preserve name/price at order time
  quantity               INT  NOT NULL CHECK (quantity > 0),
  unit_price             NUMERIC(10,2) NOT NULL,
  line_total             NUMERIC(10,2) NOT NULL,
  status                 order_item_status NOT NULL DEFAULT 'ok',
  substituted_product_id UUID REFERENCES products(id)
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON pickup_order_items(order_id);

CREATE TABLE IF NOT EXISTS payments (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                   UUID NOT NULL REFERENCES pickup_orders(id),
  provider                   TEXT NOT NULL DEFAULT 'clover',
  clover_checkout_session_id TEXT UNIQUE,                -- Hosted Checkout session (idempotency at create)
  clover_payment_id          TEXT UNIQUE,                -- Clover payment id from webhook (idempotency at confirm)
  amount                     NUMERIC(10,2) NOT NULL,
  currency                   TEXT NOT NULL DEFAULT 'usd',
  status                     payment_status NOT NULL DEFAULT 'unpaid',
  raw_event                  JSONB,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =====================================================================
-- NOTIFICATIONS + AUDIT
-- =====================================================================
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES users(id),
  order_id   UUID REFERENCES pickup_orders(id),
  channel    notif_channel NOT NULL,
  type       TEXT NOT NULL,                              -- order_placed | order_ready | substitution | ...
  status     notif_status NOT NULL DEFAULT 'queued',
  payload    JSONB,
  error      TEXT,
  sent_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_failed ON notifications(status) WHERE status = 'failed';

CREATE TABLE IF NOT EXISTS audit_logs (                  -- sensitive actions, role changes, settings
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID REFERENCES users(id),
  actor_role  user_role,
  action      TEXT NOT NULL,                             -- e.g. user.role_changed, order.canceled, settings.updated
  target_type TEXT,                                      -- 'user' | 'order' | 'product' | 'settings' ...
  target_id   TEXT,
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_logs(action);

-- =====================================================================
-- OWNER PROTECTION  (RLS + guard trigger on users)
-- Three independent layers; any one stops an escalation that bypassed the app.
-- =====================================================================
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- (1) Owner: full control over every account, including other owners.
DROP POLICY IF EXISTS users_owner_all ON users;
CREATE POLICY users_owner_all ON users FOR ALL
  USING      ( auth_user_role() = 'owner_admin' )
  WITH CHECK ( auth_user_role() = 'owner_admin' );

-- (2) Technology Specialist: manage accounts BELOW owner_admin only.
DROP POLICY IF EXISTS users_ts_select ON users;
CREATE POLICY users_ts_select ON users FOR SELECT
  USING ( auth_user_role() = 'technology_specialist' );

DROP POLICY IF EXISTS users_ts_insert ON users;
CREATE POLICY users_ts_insert ON users FOR INSERT
  WITH CHECK ( auth_user_role() = 'technology_specialist'
               AND role <> 'owner_admin' );              -- cannot create an owner_admin

DROP POLICY IF EXISTS users_ts_update ON users;
CREATE POLICY users_ts_update ON users FOR UPDATE
  USING      ( auth_user_role() = 'technology_specialist'
               AND role <> 'owner_admin' )               -- cannot modify an owner_admin row
  WITH CHECK ( role <> 'owner_admin' );                  -- cannot promote anyone to owner_admin

DROP POLICY IF EXISTS users_ts_delete ON users;
CREATE POLICY users_ts_delete ON users FOR DELETE
  USING ( auth_user_role() = 'technology_specialist'
          AND role <> 'owner_admin' );                   -- cannot delete an owner_admin

-- (Customers may read/update only their own row — example; tighten as needed.)
DROP POLICY IF EXISTS users_self_select ON users;
CREATE POLICY users_self_select ON users FOR SELECT USING ( id = auth.uid() );
DROP POLICY IF EXISTS users_self_update ON users;
CREATE POLICY users_self_update ON users FOR UPDATE
  USING ( id = auth.uid() )
  WITH CHECK ( id = auth.uid() AND role = (SELECT role FROM users u WHERE u.id = auth.uid()) );
  -- self-update may not change one's own role; the trigger below is the backstop.

-- (3) Guard trigger: independent wall. Refuses any non-owner attempt to create,
--     alter, promote-to, demote-from, or delete an owner_admin. Trusted server
--     contexts (migrations/service role, auth.uid() IS NULL) pass through.
CREATE OR REPLACE FUNCTION protect_owner_admin()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE actor user_role := auth_user_role();
BEGIN
  IF auth.uid() IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;   -- trusted backend/migration
  IF actor = 'owner_admin' THEN RETURN COALESCE(NEW, OLD); END IF; -- only an owner may touch an owner

  IF (TG_OP = 'INSERT' AND NEW.role = 'owner_admin')
     OR (TG_OP = 'UPDATE' AND (OLD.role = 'owner_admin' OR NEW.role = 'owner_admin'))
     OR (TG_OP = 'DELETE' AND OLD.role = 'owner_admin') THEN
    RAISE EXCEPTION
      'Forbidden: only an owner_admin may create, modify, promote, demote, or delete an owner_admin account';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_protect_owner_admin ON users;
CREATE TRIGGER trg_protect_owner_admin
  BEFORE INSERT OR UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION protect_owner_admin();

-- ---------------------------------------------------------------------
-- RLS NOTES for other tables (implement per module; pattern shown):
--   • Enable RLS on every data table.
--   • Catalog (categories/products/product_barcodes/inventory): SELECT open to
--     all authenticated; write limited to roles holding products.write/inventory.write
--     (inventory_staff, manager, admin, technology_specialist, owner_admin).
--   • pickup_orders/pickup_order_items: a customer sees only their own
--     (customer_id = auth.uid()); staff+ see all; updates limited to roles with
--     orders.update.
--   • notifications/audit_logs/system_settings: staff/elevated read; writes via
--     Edge Functions or roles holding the matching permission. audit_logs is
--     append-only (no UPDATE/DELETE policy).
--   • clover_credentials: RLS enabled with NO policies => readable ONLY by the
--     service role (Edge Functions). No app role, including Owner and Technology
--     Specialist, can read Clover tokens/keys. App secret + Ecommerce API token
--     live in Edge Function SECRETS, never in the DB or any client.
--   • payments.clover_payment_id / clover_checkout_session_id are the idempotency
--     anchors for the Clover payment webhook (dedupe retries).
--   • Example (price writes):
--       CREATE POLICY products_price_write ON products FOR UPDATE
--         USING ( auth_user_role() IN
--           ('inventory_staff','manager','admin','technology_specialist','owner_admin') );
-- ---------------------------------------------------------------------

-- =====================================================================
-- SEED DATA — roles, permissions, role_permissions, settings
-- =====================================================================
INSERT INTO roles (key, name, rank, is_protected, description) VALUES
  ('owner_admin',          'Owner',                 100, TRUE,  'Highest authority. Protected at the DB layer. Only role that can affect another owner.'),
  ('technology_specialist','Technology Specialist',  90, FALSE, 'Broad technical + operational access and user admin BELOW owner. Cannot affect the Owner.'),
  ('admin',                'Admin',                  80, FALSE, 'Operational administration below Technology Specialist.'),
  ('manager',              'Manager',                70, FALSE, 'Store operations: orders, inventory, customers, staff, reports.'),
  ('inventory_staff',      'Inventory Staff',        50, FALSE, 'Products, prices, barcodes, stock.'),
  ('order_staff',          'Order Staff',            50, FALSE, 'Order preparation and status updates.'),
  ('staff',                'Staff',                  40, FALSE, 'General floor/cashier staff.'),
  ('customer',             'Customer',               10, FALSE, 'Registered shopper.'),
  ('guest',                'Guest',                   0, FALSE, 'Unregistered browser.'),
  ('developer',            'Developer / System',     -1, FALSE, 'Backend/infra identity. Not part of the store-facing hierarchy.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO permissions (key, description, owner_only) VALUES
  ('catalog.browse',            'Browse products/prices/stock',                 FALSE),
  ('products.read',             'Read product records',                         FALSE),
  ('products.write',            'Create/edit/hide products',                    FALSE),
  ('inventory.read',            'Read inventory levels',                        FALSE),
  ('inventory.write',           'Adjust stock levels',                          FALSE),
  ('prices.write',              'Change prices/sale prices',                    FALSE),
  ('barcodes.manage',           'Add/edit barcodes; scan tools',                FALSE),
  ('orders.read_own',           'Read own orders',                              FALSE),
  ('orders.read_all',           'Read all orders',                              FALSE),
  ('orders.update',             'Update order status / items / substitutions',  FALSE),
  ('orders.cancel',             'Cancel orders',                                FALSE),
  ('customers.manage',          'View/manage customers + support tools',        FALSE),
  ('pickup.rules_manage',       'Manage pickup rules & time slots',             FALSE),
  ('notifications.read',        'View notification logs',                       FALSE),
  ('notifications.resend',      'Resend failed notifications',                  FALSE),
  ('reports.view',              'View reports',                                 FALSE),
  ('settings.basic',            'Edit basic store settings',                    FALSE),
  ('settings.system',           'Edit system-level settings',                   FALSE),
  ('users.manage_below_owner',  'Create/edit/activate/deactivate users below owner', FALSE),
  ('roles.assign_below_owner',  'Assign/remove roles below owner',              FALSE),
  ('maintenance.tools',         'App maintenance/config tools',                 FALSE),
  ('testing.tools',             'Testing/debugging tools',                      FALSE),
  ('db.troubleshoot_scoped',    'Scoped, read-mostly DB troubleshooting',       FALSE),
  ('owner.protected',           'Ownership-level controls: transfer ownership, change owner security, modify role hierarchy', TRUE)
ON CONFLICT (key) DO NOTHING;

-- Map permissions to roles. (owner_admin is granted ALL, including owner.protected.)
-- guest
INSERT INTO role_permissions (role_key, permission_key)
SELECT 'guest', k FROM (VALUES ('catalog.browse')) AS t(k)
ON CONFLICT DO NOTHING;
-- customer
INSERT INTO role_permissions (role_key, permission_key)
SELECT 'customer', k FROM (VALUES ('catalog.browse'),('orders.read_own')) AS t(k)
ON CONFLICT DO NOTHING;
-- staff
INSERT INTO role_permissions (role_key, permission_key)
SELECT 'staff', k FROM (VALUES
  ('catalog.browse'),('products.read'),('inventory.read'),('orders.read_all'),('orders.update'),('barcodes.manage')
) AS t(k) ON CONFLICT DO NOTHING;
-- order_staff
INSERT INTO role_permissions (role_key, permission_key)
SELECT 'order_staff', k FROM (VALUES
  ('catalog.browse'),('products.read'),('inventory.read'),('orders.read_all'),('orders.update'),('orders.cancel'),('barcodes.manage')
) AS t(k) ON CONFLICT DO NOTHING;
-- inventory_staff
INSERT INTO role_permissions (role_key, permission_key)
SELECT 'inventory_staff', k FROM (VALUES
  ('catalog.browse'),('products.read'),('products.write'),('inventory.read'),('inventory.write'),('prices.write'),('barcodes.manage')
) AS t(k) ON CONFLICT DO NOTHING;
-- manager
INSERT INTO role_permissions (role_key, permission_key)
SELECT 'manager', k FROM (VALUES
  ('catalog.browse'),('products.read'),('products.write'),('inventory.read'),('inventory.write'),('prices.write'),
  ('barcodes.manage'),('orders.read_all'),('orders.update'),('orders.cancel'),('customers.manage'),
  ('pickup.rules_manage'),('notifications.read'),('notifications.resend'),('reports.view'),('settings.basic'),
  ('users.manage_below_owner'),('roles.assign_below_owner')
) AS t(k) ON CONFLICT DO NOTHING;
-- admin (manager set; tune as needed)
INSERT INTO role_permissions (role_key, permission_key)
SELECT 'admin', permission_key FROM role_permissions WHERE role_key = 'manager'
ON CONFLICT DO NOTHING;
-- technology_specialist: every operational permission + maintenance/testing/db + system settings.
-- NOTE: explicitly NOT owner.protected. The protect_owner_permission trigger would
-- block it anyway, but we never even attempt to grant it.
INSERT INTO role_permissions (role_key, permission_key)
SELECT 'technology_specialist', key FROM permissions WHERE owner_only = FALSE
ON CONFLICT DO NOTHING;
-- owner_admin: ALL permissions (including owner.protected).
INSERT INTO role_permissions (role_key, permission_key)
SELECT 'owner_admin', key FROM permissions
ON CONFLICT DO NOTHING;
-- developer: backend infra tools only.
INSERT INTO role_permissions (role_key, permission_key)
SELECT 'developer', k FROM (VALUES
  ('maintenance.tools'),('testing.tools'),('db.troubleshoot_scoped')
) AS t(k) ON CONFLICT DO NOTHING;

-- Default store settings row.
INSERT INTO system_settings (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- OWNER BOOTSTRAP (manual, human-run — never auto-seed a second owner).
-- Run ONCE by a trusted operator with service-role/admin access. Because
-- auth.uid() is NULL in this trusted context, the guard trigger permits it.
--   INSERT INTO users (id, email, phone, full_name, role)
--   VALUES ('<auth.users id of the owner>', 'owner@dchilloutpost.com',
--           '+1XXXXXXXXXX', 'Store Owner', 'owner_admin');
-- After this, only an existing owner can create another owner.
-- ---------------------------------------------------------------------

-- Optional Technology Specialist seed (created by the Owner in practice).
--   INSERT INTO users (id, email, phone, full_name, role)
--   VALUES ('<auth.users id>', 'tech@dchilloutpost.com',
--           '+1XXXXXXXXXX', 'Technology Specialist', 'technology_specialist');
