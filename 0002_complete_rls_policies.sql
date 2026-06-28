-- =====================================================================
--  DChill Outpost — Migration 0002_complete_rls_policies.sql
--  Forward-only. Idempotent (safe to re-run). Apply AFTER DATABASE_SCHEMA.sql.
--
--  PURPOSE
--  -------
--  DATABASE_SCHEMA.sql shipped with RLS on only `users` and `clover_credentials`.
--  This migration enables RLS and defines policies for EVERY remaining table that
--  holds customer, store, order, inventory, payment, notification, or audit data,
--  per USER_ROLES.md. "A table without policies is a bug" — this closes them all.
--
--  PRESERVES (never weakened or removed here):
--    auth_user_role(), protect_owner_admin(), trg_protect_owner_admin,
--    protect_owner_permission(), users_owner_all, users_ts_* policies.
--  Adds admin/manager user-management ON TOP of those, with the same Owner guards.
--
--  MODEL: grants are broad (anon/authenticated); RLS does the real gating.
--  Service role bypasses RLS and is used by Edge Functions only.
-- =====================================================================

BEGIN;

-- =====================================================================
-- A. HELPER FUNCTIONS (SECURITY DEFINER => bypass RLS, no recursion)
-- =====================================================================
CREATE OR REPLACE FUNCTION is_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth_user_role() = 'owner_admin';
$$;

-- Management-capable non-owner roles + owner.
CREATE OR REPLACE FUNCTION is_elevated_role() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth_user_role() IN ('manager','admin','technology_specialist','owner_admin');
$$;

-- Any operational role that uses the admin dashboard (staff and above).
CREATE OR REPLACE FUNCTION is_staff_or_above() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth_user_role() IN
    ('staff','order_staff','inventory_staff','manager','admin','technology_specialist','owner_admin');
$$;

-- Does the caller's role hold a permission key? (role_permissions catalog)
CREATE OR REPLACE FUNCTION has_permission(permission_key text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_key = auth_user_role()
      AND rp.permission_key = has_permission.permission_key
  );
$$;

-- Hard-coded rank (avoids any RLS dependency on the roles table).
CREATE OR REPLACE FUNCTION role_rank(r user_role) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE r
    WHEN 'owner_admin' THEN 100
    WHEN 'technology_specialist' THEN 90
    WHEN 'admin' THEN 80
    WHEN 'manager' THEN 70
    WHEN 'inventory_staff' THEN 50
    WHEN 'order_staff' THEN 50
    WHEN 'staff' THEN 40
    WHEN 'customer' THEN 10
    WHEN 'guest' THEN 0
    WHEN 'developer' THEN -1
  END;
$$;

-- May the caller manage the target user? Owner: anyone. Elevated non-owner:
-- targets that are NOT owner_admin and rank <= caller's rank. Everyone else: no.
CREATE OR REPLACE FUNCTION can_manage_user(target_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth_user_role() = 'owner_admin' THEN true
    WHEN is_elevated_role() THEN COALESCE((
      SELECT u.role <> 'owner_admin'
             AND role_rank(u.role) <= role_rank(auth_user_role())
      FROM users u WHERE u.id = target_user_id
    ), false)
    ELSE false
  END;
$$;

-- May the caller assign this role? Owner: any. Elevated non-owner: any role that
-- is NOT owner_admin and rank <= caller's rank. Everyone else: no.
CREATE OR REPLACE FUNCTION can_assign_role(target_role user_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth_user_role() = 'owner_admin' THEN true
    WHEN is_elevated_role() THEN
      target_role <> 'owner_admin'
      AND role_rank(target_role) <= role_rank(auth_user_role())
    ELSE false
  END;
$$;

GRANT EXECUTE ON FUNCTION
  is_owner(), is_elevated_role(), is_staff_or_above(),
  has_permission(text), role_rank(user_role),
  can_manage_user(uuid), can_assign_role(user_role)
TO anon, authenticated;

-- =====================================================================
-- B. BASELINE TABLE GRANTS (RLS narrows these to the right rows/roles)
--    All human roles — including Owner — connect as `authenticated`; the
--    distinction is enforced by RLS via auth_user_role(), never by grant.
-- =====================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON
  addresses, favorites, carts, cart_items,
  products, product_barcodes, categories, inventory, inventory_logs,
  pickup_orders, pickup_order_items,
  order_windows, pickup_time_slots, system_settings,
  roles, permissions, role_permissions
TO authenticated;

GRANT SELECT ON notifications TO authenticated;                 -- writes = service role only
-- payments: column-level SELECT only (raw_event is service-role-only; see policies below)
REVOKE ALL ON payments FROM anon, authenticated;
GRANT SELECT (
  id, order_id, provider, clover_checkout_session_id, clover_payment_id,
  amount, currency, status, created_at
) ON payments TO authenticated;
GRANT SELECT, INSERT ON audit_logs TO authenticated;          -- append-only (no UPDATE/DELETE)

GRANT SELECT ON
  categories, products, product_barcodes, order_windows, pickup_time_slots
TO anon;                                                       -- public catalog/slots (RLS-filtered)

-- =====================================================================
-- C. ENABLE RLS ON EVERY TABLE (idempotent; users/clover_credentials already on)
-- =====================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','addresses','roles','permissions','role_permissions',
    'categories','products','product_barcodes','inventory','inventory_logs',
    'favorites','carts','cart_items','system_settings','order_windows',
    'pickup_time_slots','pickup_orders','pickup_order_items','payments',
    'notifications','audit_logs','clover_credentials',
    'brands','order_status_history'                    -- only if present (master-doc schema)
  ] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- =====================================================================
-- D. POLICIES
--    USING   => which rows are visible/affectable (SELECT/UPDATE/DELETE)
--    CHECK   => which row values are allowed (INSERT/UPDATE)
-- =====================================================================

-- ---- CATALOG: categories (public read active; write = products.write) ----
DROP POLICY IF EXISTS categories_read   ON categories;
CREATE POLICY categories_read ON categories FOR SELECT
  USING ( is_active OR is_staff_or_above() );
DROP POLICY IF EXISTS categories_write  ON categories;
CREATE POLICY categories_write ON categories FOR ALL
  USING ( has_permission('products.write') )
  WITH CHECK ( has_permission('products.write') );

-- ---- CATALOG: products (public sees customer-visible; staff see all) ----
DROP POLICY IF EXISTS products_public_read ON products;
CREATE POLICY products_public_read ON products FOR SELECT
  USING ( status NOT IN ('hidden','admin_only') );
DROP POLICY IF EXISTS products_staff_read ON products;
CREATE POLICY products_staff_read ON products FOR SELECT
  USING ( is_staff_or_above() );
DROP POLICY IF EXISTS products_write ON products;
CREATE POLICY products_write ON products FOR ALL          -- create/edit/hide/reprice
  USING ( has_permission('products.write') OR has_permission('prices.write') )
  WITH CHECK ( has_permission('products.write') OR has_permission('prices.write') );

-- ---- CATALOG: product_barcodes (read for visible products; write = barcodes.manage) ----
DROP POLICY IF EXISTS barcodes_read ON product_barcodes;
CREATE POLICY barcodes_read ON product_barcodes FOR SELECT
  USING ( is_staff_or_above()
          OR EXISTS (SELECT 1 FROM products p
                     WHERE p.id = product_barcodes.product_id
                       AND p.status NOT IN ('hidden','admin_only')) );
DROP POLICY IF EXISTS barcodes_write ON product_barcodes;
CREATE POLICY barcodes_write ON product_barcodes FOR ALL
  USING ( has_permission('barcodes.manage') )
  WITH CHECK ( has_permission('barcodes.manage') );

-- ---- INVENTORY (raw counts are staff-only; customers use products.status) ----
DROP POLICY IF EXISTS inventory_read ON inventory;
CREATE POLICY inventory_read ON inventory FOR SELECT
  USING ( is_staff_or_above() );
DROP POLICY IF EXISTS inventory_write ON inventory;
CREATE POLICY inventory_write ON inventory FOR ALL
  USING ( has_permission('inventory.write') )
  WITH CHECK ( has_permission('inventory.write') );

-- ---- INVENTORY LOGS (staff read; write via inventory.write or service role; no edits) ----
DROP POLICY IF EXISTS inv_logs_read ON inventory_logs;
CREATE POLICY inv_logs_read ON inventory_logs FOR SELECT
  USING ( is_staff_or_above() );
DROP POLICY IF EXISTS inv_logs_insert ON inventory_logs;
CREATE POLICY inv_logs_insert ON inventory_logs FOR INSERT
  WITH CHECK ( has_permission('inventory.write') );

-- ---- FAVORITES / CART (customer owns their own rows) ----
DROP POLICY IF EXISTS favorites_own ON favorites;
CREATE POLICY favorites_own ON favorites FOR ALL
  USING ( customer_id = auth.uid() )
  WITH CHECK ( customer_id = auth.uid() );

DROP POLICY IF EXISTS carts_own ON carts;
CREATE POLICY carts_own ON carts FOR ALL
  USING ( customer_id = auth.uid() )
  WITH CHECK ( customer_id = auth.uid() );

DROP POLICY IF EXISTS cart_items_own ON cart_items;
CREATE POLICY cart_items_own ON cart_items FOR ALL
  USING ( EXISTS (SELECT 1 FROM carts c
                  WHERE c.id = cart_items.cart_id AND c.customer_id = auth.uid()) )
  WITH CHECK ( EXISTS (SELECT 1 FROM carts c
                  WHERE c.id = cart_items.cart_id AND c.customer_id = auth.uid()) );

-- ---- ADDRESSES (customer owns; support staff with customers.manage may read) ----
DROP POLICY IF EXISTS addresses_own ON addresses;
CREATE POLICY addresses_own ON addresses FOR ALL
  USING ( user_id = auth.uid() )
  WITH CHECK ( user_id = auth.uid() );
DROP POLICY IF EXISTS addresses_support_read ON addresses;
CREATE POLICY addresses_support_read ON addresses FOR SELECT
  USING ( has_permission('customers.manage') );

-- ---- PICKUP ORDERS (customer reads/creates own; staff per permission) ----
DROP POLICY IF EXISTS orders_own_read ON pickup_orders;
CREATE POLICY orders_own_read ON pickup_orders FOR SELECT
  USING ( customer_id = auth.uid() );
DROP POLICY IF EXISTS orders_own_insert ON pickup_orders;
CREATE POLICY orders_own_insert ON pickup_orders FOR INSERT
  WITH CHECK ( customer_id = auth.uid() );
DROP POLICY IF EXISTS orders_staff_read ON pickup_orders;
CREATE POLICY orders_staff_read ON pickup_orders FOR SELECT
  USING ( has_permission('orders.read_all') );
DROP POLICY IF EXISTS orders_staff_update ON pickup_orders;
CREATE POLICY orders_staff_update ON pickup_orders FOR UPDATE
  USING ( has_permission('orders.update') )
  WITH CHECK ( has_permission('orders.update') );
-- NOTE: customers do not UPDATE/DELETE orders directly; cancellation runs through
-- an Edge Function (service role). Add a narrow customer-cancel policy later if desired.

-- ---- PICKUP ORDER ITEMS (own via parent order; staff per permission) ----
DROP POLICY IF EXISTS order_items_own_read ON pickup_order_items;
CREATE POLICY order_items_own_read ON pickup_order_items FOR SELECT
  USING ( EXISTS (SELECT 1 FROM pickup_orders o
                  WHERE o.id = pickup_order_items.order_id AND o.customer_id = auth.uid()) );
DROP POLICY IF EXISTS order_items_own_insert ON pickup_order_items;
CREATE POLICY order_items_own_insert ON pickup_order_items FOR INSERT
  WITH CHECK ( EXISTS (SELECT 1 FROM pickup_orders o
                  WHERE o.id = pickup_order_items.order_id AND o.customer_id = auth.uid()) );
DROP POLICY IF EXISTS order_items_staff_read ON pickup_order_items;
CREATE POLICY order_items_staff_read ON pickup_order_items FOR SELECT
  USING ( has_permission('orders.read_all') );
DROP POLICY IF EXISTS order_items_staff_write ON pickup_order_items;
CREATE POLICY order_items_staff_write ON pickup_order_items FOR ALL
  USING ( has_permission('orders.update') )
  WITH CHECK ( has_permission('orders.update') );

-- ---- PAYMENTS (customer sees own status; raw_event is service-role-only; no client writes) ----
DROP POLICY IF EXISTS payments_own_read ON payments;
CREATE POLICY payments_own_read ON payments FOR SELECT
  USING ( EXISTS (SELECT 1 FROM pickup_orders o
                  WHERE o.id = payments.order_id AND o.customer_id = auth.uid()) );
DROP POLICY IF EXISTS payments_staff_read ON payments;
CREATE POLICY payments_staff_read ON payments FOR SELECT
  USING ( is_elevated_role() );                              -- reconciliation (manager/admin/ts/owner)
-- No INSERT/UPDATE/DELETE policies => only the service role (Edge Functions) writes payments.
-- raw_event is omitted from the column-level SELECT grant above; only service_role can read it.

-- ---- NOTIFICATIONS (internals are operational; customers get the real SMS/email, not this table) ----
DROP POLICY IF EXISTS notifications_read ON notifications;
CREATE POLICY notifications_read ON notifications FOR SELECT
  USING ( has_permission('notifications.read') );
-- No client write policies => sends/resends run through Edge Functions (service role).

-- ---- ORDER WINDOWS (store hours: public read; write = pickup.rules_manage) ----
DROP POLICY IF EXISTS order_windows_read ON order_windows;
CREATE POLICY order_windows_read ON order_windows FOR SELECT USING ( true );
DROP POLICY IF EXISTS order_windows_write ON order_windows;
CREATE POLICY order_windows_write ON order_windows FOR ALL
  USING ( has_permission('pickup.rules_manage') )
  WITH CHECK ( has_permission('pickup.rules_manage') );

-- ---- PICKUP TIME SLOTS (active slots public for booking; write = pickup.rules_manage / service) ----
DROP POLICY IF EXISTS slots_read ON pickup_time_slots;
CREATE POLICY slots_read ON pickup_time_slots FOR SELECT
  USING ( is_active OR is_staff_or_above() );
DROP POLICY IF EXISTS slots_write ON pickup_time_slots;
CREATE POLICY slots_write ON pickup_time_slots FOR ALL
  USING ( has_permission('pickup.rules_manage') )
  WITH CHECK ( has_permission('pickup.rules_manage') );
-- NOTE: slot booking (orders_count++) runs through the order Edge Function (service role).

-- ---- SYSTEM SETTINGS (staff read; basic write = settings.basic; system fields tiered below) ----
DROP POLICY IF EXISTS settings_read ON system_settings;
CREATE POLICY settings_read ON system_settings FOR SELECT
  USING ( is_staff_or_above() );
DROP POLICY IF EXISTS settings_write ON system_settings;
CREATE POLICY settings_write ON system_settings FOR UPDATE
  USING ( has_permission('settings.basic') )
  WITH CHECK ( has_permission('settings.basic') );
-- Tiered guard: payment/Clover system fields require settings.system (TS/Owner), not just basic.
CREATE OR REPLACE FUNCTION protect_system_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;            -- trusted server/migration
  IF ( NEW.payment_provider   IS DISTINCT FROM OLD.payment_provider
    OR NEW.clover_sync_mode   IS DISTINCT FROM OLD.clover_sync_mode
    OR NEW.clover_merchant_id IS DISTINCT FROM OLD.clover_merchant_id )
     AND NOT has_permission('settings.system') THEN
    RAISE EXCEPTION 'Forbidden: changing payment/Clover system settings requires settings.system';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_protect_system_settings ON system_settings;
CREATE TRIGGER trg_protect_system_settings BEFORE UPDATE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION protect_system_settings();

-- ---- RBAC CATALOG: roles / permissions (read = staff+; write = Owner only) ----
DROP POLICY IF EXISTS roles_read ON roles;
CREATE POLICY roles_read ON roles FOR SELECT USING ( is_staff_or_above() );
DROP POLICY IF EXISTS roles_write ON roles;
CREATE POLICY roles_write ON roles FOR ALL
  USING ( is_owner() ) WITH CHECK ( is_owner() );

DROP POLICY IF EXISTS permissions_read ON permissions;
CREATE POLICY permissions_read ON permissions FOR SELECT USING ( is_staff_or_above() );
DROP POLICY IF EXISTS permissions_write ON permissions;
CREATE POLICY permissions_write ON permissions FOR ALL
  USING ( is_owner() ) WITH CHECK ( is_owner() );

-- role_permissions: a user may read their OWN role's grants (for UI gating);
-- staff+ read all; only Owner writes (protect_owner_permission trigger also guards).
DROP POLICY IF EXISTS role_permissions_read ON role_permissions;
CREATE POLICY role_permissions_read ON role_permissions FOR SELECT
  USING ( role_key = auth_user_role() OR is_staff_or_above() );
DROP POLICY IF EXISTS role_permissions_write ON role_permissions;
CREATE POLICY role_permissions_write ON role_permissions FOR ALL
  USING ( is_owner() ) WITH CHECK ( is_owner() );

-- ---- AUDIT LOGS (append-only; elevated read; never customers) ----
DROP POLICY IF EXISTS audit_read ON audit_logs;
CREATE POLICY audit_read ON audit_logs FOR SELECT
  USING ( is_elevated_role() );                              -- manager/admin/ts/owner
DROP POLICY IF EXISTS audit_insert ON audit_logs;
CREATE POLICY audit_insert ON audit_logs FOR INSERT
  WITH CHECK ( is_staff_or_above() );
-- No UPDATE/DELETE policies. Belt-and-suspenders at the privilege layer too:
REVOKE UPDATE, DELETE ON audit_logs FROM authenticated, anon;

-- =====================================================================
-- E. USERS — add Admin & Manager management BELOW Owner (existing owner/TS
--    policies and the guard trigger are untouched).
-- =====================================================================
DROP POLICY IF EXISTS users_mgmt_select ON users;
CREATE POLICY users_mgmt_select ON users FOR SELECT
  USING ( auth_user_role() IN ('admin','manager') );

DROP POLICY IF EXISTS users_mgmt_insert ON users;
CREATE POLICY users_mgmt_insert ON users FOR INSERT
  WITH CHECK ( auth_user_role() IN ('admin','manager')
               AND role <> 'owner_admin'
               AND can_assign_role(role) );

DROP POLICY IF EXISTS users_mgmt_update ON users;
CREATE POLICY users_mgmt_update ON users FOR UPDATE
  USING ( auth_user_role() IN ('admin','manager')
          AND role <> 'owner_admin' AND can_manage_user(id) )
  WITH CHECK ( role <> 'owner_admin' AND can_assign_role(role) );

DROP POLICY IF EXISTS users_mgmt_delete ON users;
CREATE POLICY users_mgmt_delete ON users FOR DELETE
  USING ( auth_user_role() IN ('admin','manager')
          AND role <> 'owner_admin' AND can_manage_user(id) );

-- =====================================================================
-- F. CLOVER CREDENTIALS — reaffirm the lock (RLS on, no policies, no grants).
--    Only the service role (Edge Functions) can read it. Owner/TS/anyone => 0 rows.
-- =====================================================================
ALTER TABLE clover_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON clover_credentials FROM anon, authenticated;

-- =====================================================================
-- G. SANITIZED VIEWS for client consumption
-- =====================================================================
-- Public store settings the app needs (NO clover_merchant_id / sync mode / secrets).
-- Definer view (default) so even anon can read these non-sensitive fields.
DROP VIEW IF EXISTS store_settings_public;
CREATE VIEW store_settings_public AS
  SELECT store_name, tax_rate, min_prep_minutes, min_order_amount,
         max_orders_per_slot, same_day_enabled, delivery_enabled
  FROM system_settings;
GRANT SELECT ON store_settings_public TO anon, authenticated;

-- Customer-safe payment status (NO raw_event). security_invoker => payments RLS
-- applies, so a customer sees only their own order's payment status.
DROP VIEW IF EXISTS payment_status_v;
CREATE VIEW payment_status_v WITH (security_invoker = true) AS
  SELECT id, order_id, provider, amount, currency, status, created_at
  FROM payments;
GRANT SELECT ON payment_status_v TO authenticated;

COMMIT;

-- =====================================================================
-- ASSUMPTIONS (see migration notes / owner confirmation):
--  1. Customers do NOT directly UPDATE/DELETE orders; cancellation is an Edge
--     Function (service role). Add a narrow customer-cancel policy if you want
--     in-app self-cancel before acceptance.
--  2. Price edits are gated by products.write/prices.write at the row level (no
--     column-level split). Tighten with a column trigger if prices must be
--     editable only by prices.write holders who lack products.write.
--  3. roles/permissions/role_permissions are READ by staff+ (and own-role grants
--     for UI gating). If you want these hidden from non-managers, narrow to
--     is_elevated_role().
--  4. inventory raw counts are staff-only; customers rely on products.status
--     (in/low/out). Expose counts to customers only via a sanitized view if ever needed.
-- =====================================================================
