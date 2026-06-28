-- =====================================================================
--  DChill Outpost — 0003_rls_verification_clover.sql
--  Proves RLS posture for Clover mapping tables from 0003 migration.
--  Run AFTER 0003_clover_inventory_mapping.sql. Rolls back at end.
-- =====================================================================
\set ON_ERROR_STOP on
\pset pager off
BEGIN;

CREATE TEMP TABLE _t (id serial, name text, detail text, passed boolean) ON COMMIT DROP;

CREATE TEMP TABLE _req(tbl text, locked boolean) ON COMMIT DROP;
INSERT INTO _req(tbl, locked) VALUES
  ('clover_sync_runs', false),
  ('clover_webhook_events', true);

-- Reuse fixture users from prior suites (re-seed if running standalone).
INSERT INTO users (id, email, full_name, role) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'own@x.test', 'Owner', 'owner_admin'),
  ('a2222222-2222-2222-2222-222222222222', 'ts@x.test', 'Tech', 'technology_specialist'),
  ('a3333333-3333-3333-3333-333333333333', 'adm@x.test', 'Admin', 'admin'),
  ('a4444444-4444-4444-4444-444444444444', 'mgr@x.test', 'Mgr', 'manager'),
  ('a5555555-5555-5555-5555-555555555555', 'stf@x.test', 'Staff', 'staff'),
  ('a6666666-6666-6666-6666-666666666666', 'c1@x.test', 'Cust1', 'customer')
ON CONFLICT DO NOTHING;

INSERT INTO clover_sync_runs (id, run_type, status, triggered_by)
VALUES (
  'f2111111-1111-1111-1111-111111111111',
  'catalog',
  'succeeded',
  'test.seed'
) ON CONFLICT DO NOTHING;

INSERT INTO clover_webhook_events (id, clover_event_id, event_type, payload)
VALUES (
  'f3111111-1111-1111-1111-111111111111',
  'clover_evt_test_001',
  'inventory.item.updated',
  '{"merchantId":"MERCHANT_TEST","secret":"must-not-leak"}'::jsonb
) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION _count_as(p_uid uuid, p_role text, p_sql text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END,
    true);
  EXECUTE 'SET LOCAL ROLE ' || quote_ident(p_role);
  BEGIN
    EXECUTE 'SELECT count(*) FROM (' || p_sql || ') _q' INTO n;
  EXCEPTION WHEN others THEN
    n := -1;
  END;
  EXECUTE 'RESET ROLE';
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION _blocked_as(p_uid uuid, p_role text, p_sql text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r bigint;
BEGIN
  PERFORM set_config('request.jwt.claims',
    CASE WHEN p_uid IS NULL THEN '' ELSE json_build_object('sub', p_uid, 'role', 'authenticated')::text END,
    true);
  EXECUTE 'SET LOCAL ROLE ' || quote_ident(p_role);
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS r = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    RETURN (r = 0);
  EXCEPTION WHEN others THEN
    EXECUTE 'RESET ROLE';
    RETURN true;
  END;
END $$;

-- C1. RLS enabled on new tables
INSERT INTO _t(name, detail, passed)
SELECT 'RLS enabled: ' || r.tbl,
       CASE WHEN c.relrowsecurity THEN 'on' ELSE 'OFF' END,
       coalesce(c.relrowsecurity, false)
FROM _req r
JOIN pg_class c ON c.oid = ('public.' || r.tbl)::regclass;

-- C2. Policy presence: webhook events locked (0 policies); sync runs >= 1
INSERT INTO _t(name, detail, passed)
SELECT 'Policies: ' || r.tbl,
       coalesce(p.cnt, 0) || ' policies',
       CASE WHEN r.locked THEN coalesce(p.cnt, 0) = 0 ELSE coalesce(p.cnt, 0) >= 1 END
FROM _req r
LEFT JOIN (
  SELECT tablename, count(*) cnt
  FROM pg_policies
  WHERE schemaname = 'public'
  GROUP BY tablename
) p ON p.tablename = r.tbl;

-- C3. clover_webhook_events returns ZERO rows for every app role + anon
INSERT INTO _t(name, detail, passed)
SELECT 'clover_webhook_events = 0 rows for ' || x.who,
       'n=' || _count_as(x.uid, x.rolename, 'SELECT 1 FROM clover_webhook_events'),
       _count_as(x.uid, x.rolename, 'SELECT 1 FROM clover_webhook_events') <= 0
FROM (VALUES
  ('owner', 'a1111111-1111-1111-1111-111111111111'::uuid, 'authenticated'),
  ('tech_specialist', 'a2222222-2222-2222-2222-222222222222'::uuid, 'authenticated'),
  ('admin', 'a3333333-3333-3333-3333-333333333333'::uuid, 'authenticated'),
  ('manager', 'a4444444-4444-4444-4444-444444444444'::uuid, 'authenticated'),
  ('staff', 'a5555555-5555-5555-5555-555555555555'::uuid, 'authenticated'),
  ('customer', 'a6666666-6666-6666-6666-666666666666'::uuid, 'authenticated'),
  ('anon', NULL::uuid, 'anon')
) AS x(who, uid, rolename);

-- C4. payload column not readable by app roles (privilege revoked)
INSERT INTO _t(name, detail, passed)
SELECT 'webhook payload blocked for ' || x.who,
       'r=' || _count_as(x.uid, x.rolename, 'SELECT payload FROM clover_webhook_events'),
       _count_as(x.uid, x.rolename, 'SELECT payload FROM clover_webhook_events') = -1
FROM (VALUES
  ('owner', 'a1111111-1111-1111-1111-111111111111'::uuid, 'authenticated'),
  ('tech_specialist', 'a2222222-2222-2222-2222-222222222222'::uuid, 'authenticated'),
  ('staff', 'a5555555-5555-5555-5555-555555555555'::uuid, 'authenticated'),
  ('customer', 'a6666666-6666-6666-6666-666666666666'::uuid, 'authenticated'),
  ('anon', NULL::uuid, 'anon')
) AS x(who, uid, rolename);

-- C5. Staff can SELECT clover_sync_runs
INSERT INTO _t(name, detail, passed) VALUES
  ('staff can read clover_sync_runs',
   'n=' || _count_as('a5555555-5555-5555-5555-555555555555', 'authenticated', 'SELECT 1 FROM clover_sync_runs'),
   _count_as('a5555555-5555-5555-5555-555555555555', 'authenticated', 'SELECT 1 FROM clover_sync_runs') >= 1),
  ('customer cannot read clover_sync_runs',
   'n=' || _count_as('a6666666-6666-6666-6666-666666666666', 'authenticated', 'SELECT 1 FROM clover_sync_runs'),
   _count_as('a6666666-6666-6666-6666-666666666666', 'authenticated', 'SELECT 1 FROM clover_sync_runs') <= 0);

-- C6. authenticated cannot INSERT into clover_webhook_events
INSERT INTO _t(name, detail, passed) VALUES
  ('authenticated cannot INSERT clover_webhook_events',
   'blocked',
   _blocked_as(
     'a2222222-2222-2222-2222-222222222222',
     'authenticated',
     $$INSERT INTO clover_webhook_events (clover_event_id, event_type, payload)
       VALUES ('evil_evt', 'test', '{}'::jsonb)$$
   )),
  ('authenticated cannot INSERT clover_sync_runs',
   'blocked',
   _blocked_as(
     'a2222222-2222-2222-2222-222222222222',
     'authenticated',
     $$INSERT INTO clover_sync_runs (run_type, status, triggered_by)
       VALUES ('catalog', 'running', 'evil')$$
   ));

-- C7. effective_clover_sync_mode() legacy mapping
DO $$
DECLARE
  mode text;
  ok boolean;
BEGIN
  UPDATE system_settings SET clover_sync_mode = 'catalog_oneway';
  mode := effective_clover_sync_mode();
  ok := mode = 'clover_readonly';
  INSERT INTO _t(name, detail, passed) VALUES
    ('effective_clover_sync_mode: catalog_oneway -> clover_readonly', mode, ok);

  UPDATE system_settings SET clover_sync_mode = 'full';
  mode := effective_clover_sync_mode();
  ok := mode = 'clover_primary';
  INSERT INTO _t(name, detail, passed) VALUES
    ('effective_clover_sync_mode: full -> clover_primary', mode, ok);

  UPDATE system_settings SET clover_sync_mode = 'payments_only';
  mode := effective_clover_sync_mode();
  ok := mode = 'payments_only';
  INSERT INTO _t(name, detail, passed) VALUES
    ('effective_clover_sync_mode: payments_only unchanged', mode, ok);
END $$;

-- C8. New mapping columns exist
INSERT INTO _t(name, detail, passed)
SELECT 'column exists: ' || x.col,
       'ok',
       EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = x.tbl
           AND column_name = x.col
       )
FROM (VALUES
  ('categories', 'clover_category_id'),
  ('categories', 'clover_sync_status'),
  ('products', 'clover_modified_at'),
  ('product_barcodes', 'clover_alternate_code_id'),
  ('inventory_logs', 'source'),
  ('inventory_logs', 'external_ref')
) AS x(tbl, col);

\echo ''
\echo '===========  DChill Outpost — Clover mapping RLS verification  ==========='
SELECT lpad(id::text, 2) AS "#", name AS "Check", detail AS "Detail",
       CASE WHEN passed THEN 'PASS' ELSE '*** FAIL ***' END AS "Result"
FROM _t ORDER BY id;
\echo ''
SELECT count(*) AS "Total",
       count(*) FILTER (WHERE passed) AS "Passed",
       count(*) FILTER (WHERE NOT passed) AS "Failed"
FROM _t;
\echo ''

DO $$ DECLARE f int;
BEGIN
  SELECT count(*) INTO f FROM _t WHERE NOT passed;
  IF f > 0 THEN
    RAISE EXCEPTION '% Clover mapping verification check(s) FAILED — see table above.', f;
  ELSE
    RAISE NOTICE 'OK: all % Clover mapping verification checks passed.', (SELECT count(*) FROM _t);
  END IF;
END $$;

DROP FUNCTION IF EXISTS _count_as(uuid, text, text);
DROP FUNCTION IF EXISTS _blocked_as(uuid, text, text);
ROLLBACK;
