-- =====================================================================
--  DChill Outpost — RBAC SECURITY PROOF
--  Technology Specialist restrictions, enforced at the database layer.
--
--  WHAT THIS PROVES
--  ----------------
--  That a `technology_specialist` session CANNOT, no matter how it tries:
--    1. Assign owner_admin to anyone        7. Edit an owner's phone
--    2. Remove owner_admin from anyone       8. Edit an owner's login credentials
--    3. Demote an owner_admin                9. Transfer ownership
--    4. Delete an owner_admin               10. Create another owner_admin
--    5. Deactivate an owner_admin           11. Modify/override the rules
--    6. Edit an owner's email                    themselves (RLS, trigger, etc.)
--  ...and that it CAN still manage accounts BELOW owner_admin
--  (manager, inventory_staff, staff, customer, and other tech specialists).
--
--  HOW TO RUN
--  ----------
--    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f test_technology_specialist_rbac.sql
--
--  Run as a PRIVILEGED role (Supabase `postgres`, or your DB superuser /
--  table owner). The harness internally `SET ROLE authenticated` for every
--  attempt so RLS + the protect_owner_admin trigger are exercised exactly as
--  a real Technology Specialist session would hit them. It expects the schema
--  and policies from Architecture sections 2 and 3.4 to already be deployed —
--  it does NOT redefine them, so it tests the REAL rules, not a copy.
--
--  Everything happens inside ONE transaction that ends in ROLLBACK.
--  No fixtures, grants, or data survive the run.
-- =====================================================================

\set ON_ERROR_STOP on
\pset pager off

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Preconditions: the objects under test must exist.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.auth_user_role()') IS NULL THEN
    RAISE EXCEPTION 'Precondition failed: public.auth_user_role() not found. Apply Architecture 3.4 first.';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Precondition failed: auth.uid() not found (Supabase auth schema expected).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_protect_owner_admin') THEN
    RAISE EXCEPTION 'Precondition failed: trigger trg_protect_owner_admin not found. Apply Architecture 3.4 first.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    RAISE EXCEPTION 'Precondition failed: role "authenticated" not found.';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.users'::regclass) THEN
    RAISE EXCEPTION 'Precondition failed: RLS is not enabled on public.users.';
  END IF;
END $$;

-- Make sure the *privilege* layer is not what blocks the writes: we grant
-- authenticated full DML on users so that any rejection we observe is provably
-- the work of RLS / the trigger, not a missing GRANT. (Rolled back at the end.)
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_role() TO authenticated;

-- ---------------------------------------------------------------------
-- 1. Results sink + fixtures (seeded as the privileged role; auth.uid()
--    is NULL here, so the protect_owner_admin trigger treats seeding as a
--    trusted server context and lets the owner_admin row be created).
-- ---------------------------------------------------------------------
CREATE TEMP TABLE _tests (
  id          serial PRIMARY KEY,
  category    text,
  restriction text,
  expectation text,
  mechanism   text,
  passed      boolean
) ON COMMIT DROP;

CREATE TEMP TABLE _fix (label text PRIMARY KEY, id uuid) ON COMMIT DROP;
INSERT INTO _fix(label, id) VALUES
  ('owner',    '11111111-1111-1111-1111-111111111111'),
  ('ts',       '22222222-2222-2222-2222-222222222222'),
  ('manager',  '33333333-3333-3333-3333-333333333333'),
  ('invmgr',   '44444444-4444-4444-4444-444444444444'),
  ('staff',    '55555555-5555-5555-5555-555555555555'),
  ('customer', '66666666-6666-6666-6666-666666666666'),
  ('subject',  '77777777-7777-7777-7777-777777777777');  -- created by the TS during ALLOWED tests

-- Fixture UUIDs inlined into SQL executed as `authenticated` (app roles cannot read _fix).
-- Privileged assertions below may still resolve ids via _fix.

INSERT INTO public.users (id, email, phone, full_name, role, is_active) VALUES
  ((SELECT id FROM _fix WHERE label='owner'),    'owner@dchill.test',    '+15550000001', 'Owner Admin',  'owner_admin',          true),
  ((SELECT id FROM _fix WHERE label='ts'),       'ts@dchill.test',       '+15550000002', 'Tech Spec',    'technology_specialist',true),
  ((SELECT id FROM _fix WHERE label='manager'),  'manager@dchill.test',  '+15550000003', 'Store Manager','manager',              true),
  ((SELECT id FROM _fix WHERE label='invmgr'),   'invmgr@dchill.test',   '+15550000004', 'Inv Manager',  'inventory_staff',    true),
  ((SELECT id FROM _fix WHERE label='staff'),    'staff@dchill.test',    '+15550000005', 'Staff Cashier','staff',                true),
  ((SELECT id FROM _fix WHERE label='customer'), 'customer@dchill.test', '+15550000006', 'A Customer',   'customer',             true);

-- ---------------------------------------------------------------------
-- 2. Helpers: run SQL AS the Technology Specialist; log/assert as postgres.
--    SQL passed to _as_ts must use literal fixture UUIDs — never _fix — so
--    authenticated never touches harness tables during the action under test.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _as_ts(p_sql text)
RETURNS TABLE(raised boolean, errmsg text, rows_affected bigint)
LANGUAGE plpgsql AS $$
DECLARE r bigint := 0;
BEGIN
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text,
    true);                               -- transaction-local claim => auth.uid() = the TS
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    EXECUTE p_sql;
    GET DIAGNOSTICS r = ROW_COUNT;
    raised := false; errmsg := NULL; rows_affected := r;
  EXCEPTION WHEN others THEN
    raised := true; errmsg := SQLERRM; rows_affected := 0;
  END;
  EXECUTE 'RESET ROLE';
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION _is_harness_error(p_errmsg text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT p_errmsg IS NOT NULL AND p_errmsg ILIKE '%_fix%';
$$;

CREATE OR REPLACE FUNCTION _mech(
  p_raised boolean,
  p_errmsg text,
  p_rows_affected bigint
) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  IF _is_harness_error(p_errmsg) THEN
    RETURN 'INVALID — harness error (not a security block): ' || left(p_errmsg, 70);
  END IF;
  RETURN CASE
    WHEN p_raised             THEN 'blocked by exception: ' || left(coalesce(p_errmsg, ''), 70)
    WHEN p_rows_affected = 0  THEN 'blocked silently (RLS USING filtered the row; 0 rows)'
    ELSE 'NOT BLOCKED — ' || p_rows_affected || ' row(s) affected'
  END;
END $$;

CREATE OR REPLACE FUNCTION _forbidden_pass(
  p_state_ok boolean,
  p_raised boolean,
  p_errmsg text,
  p_rows_affected bigint
) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  IF _is_harness_error(p_errmsg) THEN RETURN false; END IF;
  RETURN p_state_ok AND (p_raised OR p_rows_affected = 0);
END $$;

CREATE OR REPLACE FUNCTION _allowed_pass(
  p_state_ok boolean,
  p_raised boolean,
  p_errmsg text
) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  IF _is_harness_error(p_errmsg) THEN RETURN false; END IF;
  RETURN p_state_ok AND NOT p_raised;
END $$;

-- =====================================================================
--  FORBIDDEN ACTIONS  (PASS == the action was rejected AND state intact)
-- =====================================================================

-- 1. Assign owner_admin to a manager -----------------------------------
DO $$
DECLARE res record; ok boolean;
BEGIN
  SELECT * INTO res FROM _as_ts(
    $q$ UPDATE public.users SET role='owner_admin'
        WHERE id='33333333-3333-3333-3333-333333333333'::uuid $q$);
  ok := (SELECT role FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='manager')) = 'manager'
        AND (SELECT count(*) FROM public.users WHERE role='owner_admin') = 1;
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('FORBIDDEN','1. Assign owner_admin to a manager',
     'rejected; manager unchanged; owner_admin count stays 1', _mech(res.raised, res.errmsg, res.rows_affected), _forbidden_pass(ok, res.raised, res.errmsg, res.rows_affected));
END $$;

-- 2. Remove owner_admin from the owner (set to inventory_staff) -------
DO $$
DECLARE res record; ok boolean;
BEGIN
  SELECT * INTO res FROM _as_ts(
    $q$ UPDATE public.users SET role='inventory_staff'
        WHERE id='11111111-1111-1111-1111-111111111111'::uuid $q$);
  ok := (SELECT role FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='owner')) = 'owner_admin'
        AND (SELECT count(*) FROM public.users WHERE role='owner_admin') = 1;
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('FORBIDDEN','2. Remove owner_admin role from the owner',
     'rejected; owner still owner_admin', _mech(res.raised, res.errmsg, res.rows_affected), _forbidden_pass(ok, res.raised, res.errmsg, res.rows_affected));
END $$;

-- 3. Demote an owner_admin (set to manager) ----------------------------
DO $$
DECLARE res record; ok boolean;
BEGIN
  SELECT * INTO res FROM _as_ts(
    $q$ UPDATE public.users SET role='manager'
        WHERE id='11111111-1111-1111-1111-111111111111'::uuid $q$);
  ok := (SELECT role FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='owner')) = 'owner_admin';
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('FORBIDDEN','3. Demote an owner_admin',
     'rejected; owner still owner_admin', _mech(res.raised, res.errmsg, res.rows_affected), _forbidden_pass(ok, res.raised, res.errmsg, res.rows_affected));
END $$;

-- 4. Delete an owner_admin account -------------------------------------
DO $$
DECLARE res record; ok boolean;
BEGIN
  SELECT * INTO res FROM _as_ts(
    $q$ DELETE FROM public.users WHERE id='11111111-1111-1111-1111-111111111111'::uuid $q$);
  ok := EXISTS (SELECT 1 FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='owner'))
        AND (SELECT count(*) FROM public.users WHERE role='owner_admin') = 1;
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('FORBIDDEN','4. Delete an owner_admin account',
     'rejected; owner row still present', _mech(res.raised, res.errmsg, res.rows_affected), _forbidden_pass(ok, res.raised, res.errmsg, res.rows_affected));
END $$;

-- 5. Deactivate an owner_admin account ---------------------------------
DO $$
DECLARE res record; ok boolean;
BEGIN
  SELECT * INTO res FROM _as_ts(
    $q$ UPDATE public.users SET is_active=false
        WHERE id='11111111-1111-1111-1111-111111111111'::uuid $q$);
  ok := (SELECT is_active FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='owner')) = true;
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('FORBIDDEN','5. Deactivate an owner_admin account',
     'rejected; owner still active', _mech(res.raised, res.errmsg, res.rows_affected), _forbidden_pass(ok, res.raised, res.errmsg, res.rows_affected));
END $$;

-- 6. Edit an owner_admin's email ---------------------------------------
DO $$
DECLARE res record; ok boolean; orig text;
BEGIN
  SELECT email INTO orig FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='owner');
  SELECT * INTO res FROM _as_ts(
    $q$ UPDATE public.users SET email='attacker@evil.test'
        WHERE id='11111111-1111-1111-1111-111111111111'::uuid $q$);
  ok := (SELECT email FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='owner')) = orig;
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('FORBIDDEN','6. Edit an owner_admin''s email',
     'rejected; owner email unchanged', _mech(res.raised, res.errmsg, res.rows_affected), _forbidden_pass(ok, res.raised, res.errmsg, res.rows_affected));
END $$;

-- 7. Edit an owner_admin's phone ---------------------------------------
DO $$
DECLARE res record; ok boolean; orig text;
BEGIN
  SELECT phone INTO orig FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='owner');
  SELECT * INTO res FROM _as_ts(
    $q$ UPDATE public.users SET phone='+19999999999'
        WHERE id='11111111-1111-1111-1111-111111111111'::uuid $q$);
  ok := (SELECT phone FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='owner')) = orig;
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('FORBIDDEN','7. Edit an owner_admin''s phone',
     'rejected; owner phone unchanged', _mech(res.raised, res.errmsg, res.rows_affected), _forbidden_pass(ok, res.raised, res.errmsg, res.rows_affected));
END $$;

-- 8. Edit an owner_admin's login credentials ---------------------------
--    Login credentials live in Supabase auth.users, which `authenticated`
--    has NO grant on. We prove the TS cannot touch them directly. (If this
--    DB has no auth.users, the credential path is owned entirely by the
--    owner-checked Edge Function — recorded as such.)
DO $$
DECLARE res record; ok boolean;
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    SELECT * INTO res FROM _as_ts(
      $q$ UPDATE auth.users SET email='attacker@evil.test'
          WHERE id='11111111-1111-1111-1111-111111111111'::uuid $q$);
    ok := res.raised OR res.rows_affected = 0;
    INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
      ('FORBIDDEN','8. Edit an owner_admin''s login credentials (auth.users)',
       'rejected; no auth.users row changed', _mech(res.raised, res.errmsg, res.rows_affected), _forbidden_pass(ok, res.raised, res.errmsg, res.rows_affected));
  ELSE
    INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
      ('FORBIDDEN','8. Edit an owner_admin''s login credentials (auth.users)',
       'auth.users absent here; credential changes gated by owner-checked Edge Function',
       'not exposed at SQL layer; no GRANT to authenticated', true);
  END IF;
END $$;

-- 9. Transfer ownership (promote a new owner AND demote the old one) ----
DO $$
DECLARE r1 record; r2 record; ok boolean;
BEGIN
  SELECT * INTO r1 FROM _as_ts(
    $q$ UPDATE public.users SET role='owner_admin'
        WHERE id='33333333-3333-3333-3333-333333333333'::uuid $q$);   -- crown a new owner
  SELECT * INTO r2 FROM _as_ts(
    $q$ UPDATE public.users SET role='staff'
        WHERE id='11111111-1111-1111-1111-111111111111'::uuid $q$);     -- dethrone the old one
  ok := (SELECT role FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='manager')) = 'manager'
        AND (SELECT role FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='owner')) = 'owner_admin'
        AND (SELECT count(*) FROM public.users WHERE role='owner_admin') = 1;
  ok := ok
        AND NOT _is_harness_error(r1.errmsg) AND NOT _is_harness_error(r2.errmsg)
        AND (r1.raised OR r1.rows_affected = 0) AND (r2.raised OR r2.rows_affected = 0);
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('FORBIDDEN','9. Transfer ownership',
     'both halves rejected; ownership unchanged; owner_admin count stays 1',
     'promote: '||_mech(r1.raised, r1.errmsg, r1.rows_affected)||' | demote: '||_mech(r2.raised, r2.errmsg, r2.rows_affected), ok);
END $$;

-- 10. Create another owner_admin account -------------------------------
DO $$
DECLARE res record; ok boolean; before_cnt int;
BEGIN
  SELECT count(*) INTO before_cnt FROM public.users WHERE role='owner_admin';
  SELECT * INTO res FROM _as_ts(
    $q$ INSERT INTO public.users (id, email, full_name, role, is_active)
        VALUES (gen_random_uuid(), 'second-owner@evil.test', 'Shadow Owner', 'owner_admin', true) $q$);
  ok := (SELECT count(*) FROM public.users WHERE role='owner_admin') = before_cnt;
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('FORBIDDEN','10. Create another owner_admin account',
     'rejected; no new owner_admin created', _mech(res.raised, res.errmsg, res.rows_affected), _forbidden_pass(ok, res.raised, res.errmsg, res.rows_affected));
END $$;

-- 11. Modify / override the hierarchy & security rules themselves -------
--     A TS must not be able to disable RLS, drop the policies, drop the
--     trigger, or rewrite the guard function. Each is attempted; PASS only
--     if EVERY attempt is rejected AND the protections are still in place.
DO $$
DECLARE r1 record; r2 record; r3 record; r4 record; ok boolean;
BEGIN
  SELECT * INTO r1 FROM _as_ts('ALTER TABLE public.users DISABLE ROW LEVEL SECURITY');
  SELECT * INTO r2 FROM _as_ts('DROP POLICY users_ts_update ON public.users');
  SELECT * INTO r3 FROM _as_ts('DROP TRIGGER trg_protect_owner_admin ON public.users');
  SELECT * INTO r4 FROM _as_ts(
    $q$ CREATE OR REPLACE FUNCTION public.protect_owner_admin() RETURNS trigger
        LANGUAGE plpgsql AS 'BEGIN RETURN COALESCE(NEW, OLD); END;' $q$);  -- attempt to neuter
  ok := r1.raised AND r2.raised AND r3.raised AND r4.raised
        AND NOT _is_harness_error(r1.errmsg) AND NOT _is_harness_error(r2.errmsg)
        AND NOT _is_harness_error(r3.errmsg) AND NOT _is_harness_error(r4.errmsg)
        AND (SELECT relrowsecurity FROM pg_class WHERE oid='public.users'::regclass)        -- RLS still on
        AND EXISTS (SELECT 1 FROM pg_policies  WHERE tablename='users' AND policyname='users_ts_update')
        AND EXISTS (SELECT 1 FROM pg_trigger   WHERE tgname='trg_protect_owner_admin');
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('FORBIDDEN','11. Modify/override role-hierarchy & security rules',
     'all DDL rejected; RLS, policy, and trigger still in place',
     'disable-rls:'||r1.raised||' drop-policy:'||r2.raised||' drop-trigger:'||r3.raised||' rewrite-fn:'||r4.raised, ok);
END $$;

-- BONUS. Self-escalation: a TS promoting ITSELF to owner_admin ----------
DO $$
DECLARE res record; ok boolean;
BEGIN
  SELECT * INTO res FROM _as_ts(
    $q$ UPDATE public.users SET role='owner_admin'
        WHERE id='22222222-2222-2222-2222-222222222222'::uuid $q$);
  ok := (SELECT role FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='ts')) = 'technology_specialist';
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('FORBIDDEN','BONUS. Self-escalate (TS → owner_admin)',
     'rejected; TS stays technology_specialist', _mech(res.raised, res.errmsg, res.rows_affected), _forbidden_pass(ok, res.raised, res.errmsg, res.rows_affected));
END $$;

-- =====================================================================
--  ALLOWED ACTIONS  (PASS == the action succeeded AND state changed)
-- =====================================================================

-- A1. Create a new staff account ---------------------------------------
DO $$
DECLARE res record; ok boolean;
BEGIN
  SELECT * INTO res FROM _as_ts(
    $q$ INSERT INTO public.users (id, email, full_name, role, is_active)
        VALUES ('77777777-7777-7777-7777-777777777777'::uuid,
                'subject@dchill.test', 'New Hire', 'staff', true) $q$);
  ok := NOT res.raised
        AND (SELECT role FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='subject')) = 'staff';
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('ALLOWED','A1. Create a staff account', 'created with role staff',
     CASE WHEN res.raised THEN 'unexpected error: '||left(res.errmsg,60) ELSE 'created ('||res.rows_affected||' row)' END, _allowed_pass(ok, res.raised, res.errmsg));
END $$;

-- A2. Promote staff -> inventory_staff -------------------------------
DO $$
DECLARE res record; ok boolean;
BEGIN
  SELECT * INTO res FROM _as_ts(
    $q$ UPDATE public.users SET role='inventory_staff'
        WHERE id='77777777-7777-7777-7777-777777777777'::uuid $q$);
  ok := (SELECT role FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='subject')) = 'inventory_staff';
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('ALLOWED','A2. Promote staff -> inventory_staff', 'role is inventory_staff',
     CASE WHEN res.raised THEN 'unexpected error' ELSE 'updated' END, _allowed_pass(ok, res.raised, res.errmsg));
END $$;

-- A3. Promote inventory_staff -> manager -----------------------------
DO $$
DECLARE res record; ok boolean;
BEGIN
  SELECT * INTO res FROM _as_ts(
    $q$ UPDATE public.users SET role='manager'
        WHERE id='77777777-7777-7777-7777-777777777777'::uuid $q$);
  ok := (SELECT role FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='subject')) = 'manager';
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('ALLOWED','A3. Promote inventory_staff -> manager', 'role is manager',
     CASE WHEN res.raised THEN 'unexpected error' ELSE 'updated' END, _allowed_pass(ok, res.raised, res.errmsg));
END $$;

-- A4. Assign another technology_specialist (still below owner_admin) ----
DO $$
DECLARE res record; ok boolean;
BEGIN
  SELECT * INTO res FROM _as_ts(
    $q$ UPDATE public.users SET role='technology_specialist'
        WHERE id='77777777-7777-7777-7777-777777777777'::uuid $q$);
  ok := (SELECT role FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='subject')) = 'technology_specialist';
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('ALLOWED','A4. Assign technology_specialist role', 'role is technology_specialist',
     CASE WHEN res.raised THEN 'unexpected error' ELSE 'updated' END, _allowed_pass(ok, res.raised, res.errmsg));
END $$;

-- A5. Demote manager-level subject back down to staff ------------------
DO $$
DECLARE res record; ok boolean;
BEGIN
  SELECT * INTO res FROM _as_ts(
    $q$ UPDATE public.users SET role='staff'
        WHERE id='77777777-7777-7777-7777-777777777777'::uuid $q$);
  ok := (SELECT role FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='subject')) = 'staff';
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('ALLOWED','A5. Demote a sub-owner account', 'role is staff',
     CASE WHEN res.raised THEN 'unexpected error' ELSE 'updated' END, _allowed_pass(ok, res.raised, res.errmsg));
END $$;

-- A6 + A7. Deactivate, then reactivate a staff account -----------------
DO $$
DECLARE res record; ok boolean;
BEGIN
  SELECT * INTO res FROM _as_ts(
    $q$ UPDATE public.users SET is_active=false
        WHERE id='55555555-5555-5555-5555-555555555555'::uuid $q$);
  ok := (SELECT is_active FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='staff')) = false;
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('ALLOWED','A6. Deactivate a staff account', 'is_active = false',
     CASE WHEN res.raised THEN 'unexpected error' ELSE 'updated' END, _allowed_pass(ok, res.raised, res.errmsg));

  SELECT * INTO res FROM _as_ts(
    $q$ UPDATE public.users SET is_active=true
        WHERE id='55555555-5555-5555-5555-555555555555'::uuid $q$);
  ok := (SELECT is_active FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='staff')) = true;
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('ALLOWED','A7. Reactivate a staff account', 'is_active = true',
     CASE WHEN res.raised THEN 'unexpected error' ELSE 'updated' END, _allowed_pass(ok, res.raised, res.errmsg));
END $$;

-- A8. Edit a customer's email + phone ----------------------------------
DO $$
DECLARE res record; ok boolean;
BEGIN
  SELECT * INTO res FROM _as_ts(
    $q$ UPDATE public.users SET email='updated-customer@dchill.test', phone='+15551230000'
        WHERE id='66666666-6666-6666-6666-666666666666'::uuid $q$);
  ok := (SELECT email FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='customer')) = 'updated-customer@dchill.test';
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('ALLOWED','A8. Edit a customer''s contact info', 'email/phone updated',
     CASE WHEN res.raised THEN 'unexpected error' ELSE 'updated' END, _allowed_pass(ok, res.raised, res.errmsg));
END $$;

-- A9. Delete a (non-owner) staff account -------------------------------
DO $$
DECLARE res record; ok boolean;
BEGIN
  SELECT * INTO res FROM _as_ts(
    $q$ DELETE FROM public.users WHERE id='77777777-7777-7777-7777-777777777777'::uuid $q$);
  ok := NOT EXISTS (SELECT 1 FROM public.users WHERE id=(SELECT id FROM _fix WHERE label='subject'));
  INSERT INTO _tests(category,restriction,expectation,mechanism,passed) VALUES
    ('ALLOWED','A9. Delete a sub-owner account', 'subject account removed',
     CASE WHEN res.raised THEN 'unexpected error' ELSE 'deleted' END, _allowed_pass(ok, res.raised, res.errmsg));
END $$;

-- =====================================================================
--  RESULTS
-- =====================================================================
\echo ''
\echo '================  DChill Outpost — Technology Specialist RBAC proof  ================'
SELECT
  lpad(id::text,2)                                  AS "#",
  category                                          AS "Category",
  restriction                                       AS "Restriction / Capability",
  CASE WHEN passed THEN 'PASS' ELSE '*** FAIL ***' END AS "Result",
  mechanism                                         AS "How it was enforced"
FROM _tests
ORDER BY id;

\echo ''
SELECT
  count(*)                          AS "Total",
  count(*) FILTER (WHERE passed)    AS "Passed",
  count(*) FILTER (WHERE NOT passed) AS "Failed"
FROM _tests;
\echo ''

-- Gate: fail the run (non-zero exit under ON_ERROR_STOP) if anything failed,
-- so this can be wired straight into CI. Comment out for report-only runs.
DO $$
DECLARE f int;
BEGIN
  SELECT count(*) INTO f FROM _tests WHERE NOT passed;
  IF f > 0 THEN
    RAISE EXCEPTION '% RBAC restriction test(s) FAILED — Owner/Admin protection is NOT proven. See table above.', f;
  ELSE
    RAISE NOTICE 'OK: all % Technology Specialist RBAC tests passed.', (SELECT count(*) FROM _tests);
  END IF;
END $$;

-- Tidy up the helpers and undo every grant/fixture. Nothing persists.
DROP FUNCTION IF EXISTS _as_ts(text);
DROP FUNCTION IF EXISTS _mech(boolean, text, bigint);
DROP FUNCTION IF EXISTS _forbidden_pass(boolean, boolean, text, bigint);
DROP FUNCTION IF EXISTS _allowed_pass(boolean, boolean, text);
DROP FUNCTION IF EXISTS _is_harness_error(text);

ROLLBACK;
