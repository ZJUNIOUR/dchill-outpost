-- =====================================================================
--  ci/supabase_test_shim.sql
--  Minimal Supabase compatibility layer so the RLS / Owner-protection test
--  suite can run on a plain PostgreSQL 15+ instance in CI (or locally).
--
--  Provides what Supabase normally supplies at runtime:
--    • roles  anon, authenticated, service_role
--    • schema auth + auth.uid() / auth.role() / auth.jwt() reading the
--      `request.jwt.claims` GUC (exactly how the test harness sets identity)
--
--  Apply order in CI:  THIS FILE  ->  DATABASE_SCHEMA.sql  ->
--    0002_complete_rls_policies.sql  ->  0002_rls_verification.sql  ->
--    test_technology_specialist_rbac.sql
--
--  This file is for TEST/CI only. Never apply it to a real Supabase project —
--  Supabase already defines these roles and functions.
-- =====================================================================

-- ---- API roles (NOLOGIN; the test harness SET ROLEs into them) ----
DO $$ BEGIN CREATE ROLE anon          NOLOGIN NOINHERIT;            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN NOINHERIT;            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role  NOLOGIN NOINHERIT BYPASSRLS;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ---- auth schema + identity helpers (read request.jwt.claims) ----
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;

-- Returns the 'sub' claim as uuid; NULL when unset/empty (i.e. anon / server).
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
           ''
         )::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb;
$$;

GRANT EXECUTE ON FUNCTION auth.uid(), auth.role(), auth.jwt()
  TO anon, authenticated, service_role;
