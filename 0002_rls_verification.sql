-- =====================================================================
--  DChill Outpost — 0002_rls_verification.sql
--  Proves the RLS coverage from 0002_complete_rls_policies.sql.
--  Run as a privileged role (Supabase `postgres`); the harness drops to
--  `authenticated` / `anon` per check. Runs in ONE transaction, ROLLS BACK.
--    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0002_rls_verification.sql
-- =====================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN;

CREATE TEMP TABLE _t (id serial, name text, detail text, passed boolean) ON COMMIT DROP;

-- Required tables that MUST have RLS enabled. clover_credentials must have RLS
-- enabled with ZERO policies; all others must have >=1 policy.
CREATE TEMP TABLE _req(tbl text, locked boolean) ON COMMIT DROP;  -- locked = no-policy table
INSERT INTO _req(tbl, locked) VALUES
  ('users',false),('addresses',false),('roles',false),('permissions',false),
  ('role_permissions',false),('categories',false),('products',false),
  ('product_barcodes',false),('inventory',false),('inventory_logs',false),
  ('favorites',false),('carts',false),('cart_items',false),('system_settings',false),
  ('order_windows',false),('pickup_time_slots',false),('pickup_orders',false),
  ('pickup_order_items',false),('payments',false),('notifications',false),
  ('audit_logs',false),('clover_credentials',true);

-- ---- Fixtures (seeded privileged; auth.uid() IS NULL => guard triggers allow) ----
INSERT INTO users (id,email,full_name,role) VALUES
  ('a1111111-1111-1111-1111-111111111111','own@x.test','Owner','owner_admin'),
  ('a2222222-2222-2222-2222-222222222222','ts@x.test','Tech','technology_specialist'),
  ('a3333333-3333-3333-3333-333333333333','adm@x.test','Admin','admin'),
  ('a4444444-4444-4444-4444-444444444444','mgr@x.test','Mgr','manager'),
  ('a5555555-5555-5555-5555-555555555555','stf@x.test','Staff','staff'),
  ('a6666666-6666-6666-6666-666666666666','c1@x.test','Cust1','customer'),
  ('a7777777-7777-7777-7777-777777777777','c2@x.test','Cust2','customer')
ON CONFLICT DO NOTHING;

INSERT INTO categories(id,name,slug,is_active) VALUES
  ('b1111111-1111-1111-1111-111111111111','Drinks','drinks',true) ON CONFLICT DO NOTHING;
INSERT INTO products(id,name,slug,base_price,status) VALUES
  ('c1111111-1111-1111-1111-111111111111','Visible Item','visible',1.99,'in_stock'),
  ('c2222222-2222-2222-2222-222222222222','Hidden Item','hidden',1.99,'hidden') ON CONFLICT DO NOTHING;
INSERT INTO favorites(customer_id,product_id) VALUES
  ('a6666666-6666-6666-6666-666666666666','c1111111-1111-1111-1111-111111111111') ON CONFLICT DO NOTHING;
INSERT INTO pickup_time_slots(id,slot_date,start_time,end_time) VALUES
  ('d1111111-1111-1111-1111-111111111111', current_date, '10:00','10:30') ON CONFLICT DO NOTHING;
INSERT INTO pickup_orders(id,order_number,customer_id,pickup_slot_id,total) VALUES
  ('e1111111-1111-1111-1111-111111111111','DC-1',
   'a6666666-6666-6666-6666-666666666666','d1111111-1111-1111-1111-111111111111',1.99),
  ('e2222222-2222-2222-2222-222222222222','DC-2',
   'a7777777-7777-7777-7777-777777777777','d1111111-1111-1111-1111-111111111111',1.99) ON CONFLICT DO NOTHING;
INSERT INTO payments(id,order_id,amount,status,raw_event) VALUES
  ('f1111111-1111-1111-1111-111111111111','e1111111-1111-1111-1111-111111111111',1.99,'paid',
   '{"secret":"webhook"}'::jsonb) ON CONFLICT DO NOTHING;
INSERT INTO audit_logs(id,action) VALUES
  ('09111111-1111-1111-1111-111111111111','test.seed') ON CONFLICT DO NOTHING;
INSERT INTO clover_credentials(merchant_id,access_token_enc) VALUES
  ('MERCHANT_TEST', '\x00') ON CONFLICT DO NOTHING;

-- ---- Impersonation helpers ----
CREATE OR REPLACE FUNCTION _count_as(p_uid uuid, p_role text, p_sql text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub',p_uid,'role','authenticated')::text END, true);
  EXECUTE 'SET LOCAL ROLE '||quote_ident(p_role);
  BEGIN EXECUTE 'SELECT count(*) FROM ('||p_sql||') _q' INTO n;
  EXCEPTION WHEN others THEN n := -1; END;       -- -1 = blocked (privilege/RLS error)
  EXECUTE 'RESET ROLE';
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION _blocked_as(p_uid uuid, p_role text, p_sql text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r bigint;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub',p_uid,'role','authenticated')::text END, true);
  EXECUTE 'SET LOCAL ROLE '||quote_ident(p_role);
  BEGIN EXECUTE p_sql; GET DIAGNOSTICS r = ROW_COUNT;
        EXECUTE 'RESET ROLE'; RETURN (r = 0);     -- 0 rows affected = blocked
  EXCEPTION WHEN others THEN EXECUTE 'RESET ROLE'; RETURN true;  -- raised = blocked
  END;
END $$;

-- =====================================================================
-- T1. RLS enabled on every required table
-- =====================================================================
INSERT INTO _t(name,detail,passed)
SELECT 'RLS enabled: '||r.tbl,
       CASE WHEN c.relrowsecurity THEN 'on' ELSE 'OFF' END,
       coalesce(c.relrowsecurity,false)
FROM _req r JOIN pg_class c ON c.oid = ('public.'||r.tbl)::regclass;

-- =====================================================================
-- T2. Policy presence: clover_credentials has 0; all others >=1
-- =====================================================================
INSERT INTO _t(name,detail,passed)
SELECT 'Policies: '||r.tbl,
       coalesce(p.cnt,0)||' policies',
       CASE WHEN r.locked THEN coalesce(p.cnt,0)=0 ELSE coalesce(p.cnt,0)>=1 END
FROM _req r
LEFT JOIN (SELECT tablename, count(*) cnt FROM pg_policies WHERE schemaname='public' GROUP BY tablename) p
       ON p.tablename = r.tbl;

-- =====================================================================
-- T3. anon has NO access to sensitive tables (0 rows or blocked)
-- =====================================================================
INSERT INTO _t(name,detail,passed)
SELECT 'anon blocked: '||x.tbl, 'count='||_count_as(NULL,'anon','SELECT 1 FROM '||x.tbl),
       _count_as(NULL,'anon','SELECT 1 FROM '||x.tbl) <= 0
FROM (VALUES ('users'),('payments'),('audit_logs'),('notifications'),
             ('clover_credentials'),('system_settings'),('inventory')) AS x(tbl);

-- =====================================================================
-- T4. anon reads catalog but only customer-visible products (1 of the 2 seeded)
-- =====================================================================
INSERT INTO _t(name,detail,passed)
SELECT 'anon sees only visible products',
       'visible='||_count_as(NULL,'anon','SELECT 1 FROM products WHERE slug IN (''visible'',''hidden'')'),
       _count_as(NULL,'anon','SELECT 1 FROM products WHERE slug IN (''visible'',''hidden'')') = 1;

-- =====================================================================
-- T5/T6. Customer sees only OWN rows
-- =====================================================================
INSERT INTO _t(name,detail,passed) VALUES
 ('customer sees only own favorites',
  'n='||_count_as('a6666666-6666-6666-6666-666666666666','authenticated','SELECT 1 FROM favorites'),
  _count_as('a6666666-6666-6666-6666-666666666666','authenticated','SELECT 1 FROM favorites') = 1),
 ('customer sees only own orders (not other customer''s)',
  'n='||_count_as('a6666666-6666-6666-6666-666666666666','authenticated','SELECT 1 FROM pickup_orders'),
  _count_as('a6666666-6666-6666-6666-666666666666','authenticated','SELECT 1 FROM pickup_orders') = 1);

-- =====================================================================
-- T7. Customer: own payment STATUS visible, raw_event NOT readable, no audit/creds
-- =====================================================================
INSERT INTO _t(name,detail,passed) VALUES
 ('customer sees own payment status',
  'n='||_count_as('a6666666-6666-6666-6666-666666666666','authenticated','SELECT 1 FROM payments'),
  _count_as('a6666666-6666-6666-6666-666666666666','authenticated','SELECT 1 FROM payments') = 1),
 ('customer CANNOT read payments.raw_event (column revoked)',
  'blocked='||_count_as('a6666666-6666-6666-6666-666666666666','authenticated','SELECT raw_event FROM payments'),
  _count_as('a6666666-6666-6666-6666-666666666666','authenticated','SELECT raw_event FROM payments') = -1),
 ('customer CANNOT read audit_logs',
  'n='||_count_as('a6666666-6666-6666-6666-666666666666','authenticated','SELECT 1 FROM audit_logs'),
  _count_as('a6666666-6666-6666-6666-666666666666','authenticated','SELECT 1 FROM audit_logs') <= 0);

-- T7b. payments.raw_event is unreadable by EVERY app role (column privilege revoked).
INSERT INTO _t(name,detail,passed)
SELECT 'raw_event blocked for '||x.who,
       'r='||_count_as(x.uid, x.rolename, 'SELECT raw_event FROM payments'),
       _count_as(x.uid, x.rolename, 'SELECT raw_event FROM payments') = -1
FROM (VALUES
  ('owner','a1111111-1111-1111-1111-111111111111'::uuid,'authenticated'),
  ('tech_specialist','a2222222-2222-2222-2222-222222222222'::uuid,'authenticated'),
  ('admin','a3333333-3333-3333-3333-333333333333'::uuid,'authenticated'),
  ('manager','a4444444-4444-4444-4444-444444444444'::uuid,'authenticated'),
  ('staff','a5555555-5555-5555-5555-555555555555'::uuid,'authenticated'),
  ('customer','a6666666-6666-6666-6666-666666666666'::uuid,'authenticated'),
  ('anon',NULL::uuid,'anon')
) AS x(who,uid,rolename);

-- =====================================================================
-- T8. clover_credentials returns ZERO rows for EVERY app role + anon
-- =====================================================================
INSERT INTO _t(name,detail,passed)
SELECT 'clover_credentials = 0 rows for '||x.who,
       'n='||_count_as(x.uid, x.rolename, 'SELECT 1 FROM clover_credentials'),
       _count_as(x.uid, x.rolename, 'SELECT 1 FROM clover_credentials') <= 0
FROM (VALUES
  ('owner','a1111111-1111-1111-1111-111111111111'::uuid,'authenticated'),
  ('tech_specialist','a2222222-2222-2222-2222-222222222222'::uuid,'authenticated'),
  ('admin','a3333333-3333-3333-3333-333333333333'::uuid,'authenticated'),
  ('manager','a4444444-4444-4444-4444-444444444444'::uuid,'authenticated'),
  ('staff','a5555555-5555-5555-5555-555555555555'::uuid,'authenticated'),
  ('customer','a6666666-6666-6666-6666-666666666666'::uuid,'authenticated'),
  ('anon',NULL::uuid,'anon')
) AS x(who,uid,rolename);

-- =====================================================================
-- T9. audit_logs is append-only (UPDATE and DELETE blocked for app roles)
-- =====================================================================
INSERT INTO _t(name,detail,passed) VALUES
 ('audit_logs rejects UPDATE',
  'blocked',
  _blocked_as('a4444444-4444-4444-4444-444444444444','authenticated',
              'UPDATE audit_logs SET action=''tamper''')),
 ('audit_logs rejects DELETE',
  'blocked',
  _blocked_as('a4444444-4444-4444-4444-444444444444','authenticated',
              'DELETE FROM audit_logs'));

-- =====================================================================
-- T10. Technology Specialist: operational read works, secrets denied
-- =====================================================================
INSERT INTO _t(name,detail,passed) VALUES
 ('TS can read products (operational)',
  'n='||_count_as('a2222222-2222-2222-2222-222222222222','authenticated','SELECT 1 FROM products'),
  _count_as('a2222222-2222-2222-2222-222222222222','authenticated','SELECT 1 FROM products') >= 1),
 ('TS CANNOT read clover_credentials',
  'n='||_count_as('a2222222-2222-2222-2222-222222222222','authenticated','SELECT 1 FROM clover_credentials'),
  _count_as('a2222222-2222-2222-2222-222222222222','authenticated','SELECT 1 FROM clover_credentials') <= 0),
 ('TS CANNOT promote a manager to owner_admin (guard trigger/WITH CHECK)',
  'blocked',
  _blocked_as('a2222222-2222-2222-2222-222222222222','authenticated',
     'UPDATE users SET role=''owner_admin'' WHERE id=''a4444444-4444-4444-4444-444444444444''')),
 ('Owner still owner_admin afterward',
  'role intact',
  (SELECT role FROM users WHERE id='a1111111-1111-1111-1111-111111111111')='owner_admin');

-- =====================================================================
-- RESULTS
-- =====================================================================
\echo ''
\echo '===========  DChill Outpost — RLS coverage verification  ==========='
SELECT lpad(id::text,2) AS "#", name AS "Check", detail AS "Detail",
       CASE WHEN passed THEN 'PASS' ELSE '*** FAIL ***' END AS "Result"
FROM _t ORDER BY id;
\echo ''
SELECT count(*) AS "Total", count(*) FILTER (WHERE passed) AS "Passed",
       count(*) FILTER (WHERE NOT passed) AS "Failed" FROM _t;
\echo ''
\echo 'Reminder: also run test_technology_specialist_rbac.sql — it must still PASS.'

DO $$ DECLARE f int;
BEGIN
  SELECT count(*) INTO f FROM _t WHERE NOT passed;
  IF f > 0 THEN RAISE EXCEPTION '% RLS verification check(s) FAILED — see table above.', f;
  ELSE RAISE NOTICE 'OK: all % RLS verification checks passed.', (SELECT count(*) FROM _t);
  END IF;
END $$;

DROP FUNCTION IF EXISTS _count_as(uuid,text,text);
DROP FUNCTION IF EXISTS _blocked_as(uuid,text,text);
ROLLBACK;
