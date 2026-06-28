-- =====================================================================
--  DChill Outpost — Migration 0003_clover_inventory_mapping.sql
--  Forward-only. Clover-primary mirror mapping + sync observability.
--  Apply AFTER DATABASE_SCHEMA.sql and 0002_complete_rls_policies.sql.
--
--  Does NOT implement mirror-write guard triggers (Phase 2G).
--  Does NOT weaken Owner / Technology Specialist protection.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- A. categories — Clover mapping
-- ---------------------------------------------------------------------
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS clover_category_id TEXT,
  ADD COLUMN IF NOT EXISTS clover_sync_status TEXT NOT NULL DEFAULT 'local_only',
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS clover_modified_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS categories_clover_category_id_key
  ON categories (clover_category_id)
  WHERE clover_category_id IS NOT NULL;

COMMENT ON COLUMN categories.clover_category_id IS
  'Clover category id — POS source of truth (see MEMORY.md §6a).';
COMMENT ON COLUMN categories.clover_sync_status IS
  'local_only | synced | pending | error | conflict';

-- ---------------------------------------------------------------------
-- B. products — conflict detection
-- ---------------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS clover_modified_at TIMESTAMPTZ;

COMMENT ON COLUMN products.clover_modified_at IS
  'Last known Clover modifiedTime for conflict detection.';

-- ---------------------------------------------------------------------
-- C. product_barcodes — optional Clover code entity id
-- ---------------------------------------------------------------------
ALTER TABLE product_barcodes
  ADD COLUMN IF NOT EXISTS clover_alternate_code_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS product_barcodes_clover_alternate_code_id_key
  ON product_barcodes (clover_alternate_code_id)
  WHERE clover_alternate_code_id IS NOT NULL;

COMMENT ON COLUMN product_barcodes.clover_alternate_code_id IS
  'Clover alternate code id when distinct from barcode string; nullable.';

-- ---------------------------------------------------------------------
-- D. inventory_logs — provenance
-- ---------------------------------------------------------------------
ALTER TABLE inventory_logs
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS external_ref TEXT;

COMMENT ON COLUMN inventory_logs.source IS
  'app | clover_sync | edge_function | order_flow';
COMMENT ON COLUMN inventory_logs.external_ref IS
  'Clover event id or Edge Function idempotency key.';

CREATE INDEX IF NOT EXISTS idx_inventory_logs_external_ref
  ON inventory_logs (external_ref)
  WHERE external_ref IS NOT NULL;

-- ---------------------------------------------------------------------
-- E. inventory — align sync status vocabulary (comment only)
-- ---------------------------------------------------------------------
COMMENT ON COLUMN inventory.clover_sync_status IS
  'local_only | synced | pending | error | conflict (align with products)';

-- ---------------------------------------------------------------------
-- F. system_settings — extend clover_sync_mode (additive; keep legacy values)
-- ---------------------------------------------------------------------
ALTER TABLE system_settings DROP CONSTRAINT IF EXISTS system_settings_clover_sync_mode_check;

ALTER TABLE system_settings ADD CONSTRAINT system_settings_clover_sync_mode_check
  CHECK (clover_sync_mode IN (
    'payments_only',
    'catalog_oneway',
    'full',
    'local_dev',
    'clover_readonly',
    'clover_primary'
  ));

COMMENT ON COLUMN system_settings.clover_sync_mode IS
  'local_dev=direct Supabase writes (dev); clover_readonly=sync in only; '
  'clover_primary=write-through Edge Functions. Legacy: payments_only, catalog_oneway, full.';

-- ---------------------------------------------------------------------
-- G. effective_clover_sync_mode() — normalize legacy mode names
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION effective_clover_sync_mode()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE (SELECT clover_sync_mode FROM system_settings LIMIT 1)
    WHEN 'catalog_oneway' THEN 'clover_readonly'
    WHEN 'full' THEN 'clover_primary'
    ELSE (SELECT clover_sync_mode FROM system_settings LIMIT 1)
  END;
$$;

COMMENT ON FUNCTION effective_clover_sync_mode() IS
  'Maps legacy clover_sync_mode values to canonical modes for guards and Edge Functions. '
  'payments_only remains payments_only; local_dev/clover_readonly/clover_primary pass through.';

-- ---------------------------------------------------------------------
-- H. clover_sync_runs — operational observability (no secrets)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clover_sync_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type         TEXT NOT NULL,
  status           TEXT NOT NULL,
  merchant_id      TEXT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  records_upserted INT NOT NULL DEFAULT 0,
  records_failed   INT NOT NULL DEFAULT 0,
  error_summary    TEXT,
  triggered_by     TEXT NOT NULL,
  CONSTRAINT clover_sync_runs_run_type_check
    CHECK (run_type IN ('catalog', 'inventory', 'webhook', 'full')),
  CONSTRAINT clover_sync_runs_status_check
    CHECK (status IN ('running', 'succeeded', 'failed', 'partial'))
);

CREATE INDEX IF NOT EXISTS idx_clover_sync_runs_started
  ON clover_sync_runs (started_at DESC);

COMMENT ON TABLE clover_sync_runs IS
  'Append-only sync job history for Clover Edge Functions; no tokens or payloads.';

-- ---------------------------------------------------------------------
-- I. clover_webhook_events — idempotency (payload = service-role only)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clover_webhook_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clover_event_id TEXT NOT NULL UNIQUE,
  event_type      TEXT NOT NULL,
  merchant_id     TEXT,
  payload         JSONB NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'pending',
  sync_run_id     UUID REFERENCES clover_sync_runs (id),
  CONSTRAINT clover_webhook_events_status_check
    CHECK (status IN ('pending', 'processed', 'failed', 'ignored'))
);

CREATE INDEX IF NOT EXISTS idx_clover_webhook_events_received
  ON clover_webhook_events (received_at DESC);

COMMENT ON TABLE clover_webhook_events IS
  'Raw Clover webhook payloads — service-role only; never exposed to app roles.';

-- ---------------------------------------------------------------------
-- J. RLS + grants — clover_sync_runs (staff read; service-role write)
-- ---------------------------------------------------------------------
ALTER TABLE clover_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clover_sync_runs_read ON clover_sync_runs;
CREATE POLICY clover_sync_runs_read ON clover_sync_runs FOR SELECT
  USING ( is_staff_or_above() );

REVOKE INSERT, UPDATE, DELETE ON clover_sync_runs FROM anon, authenticated;
GRANT SELECT ON clover_sync_runs TO authenticated;

-- ---------------------------------------------------------------------
-- K. RLS + grants — clover_webhook_events (mirror clover_credentials lock)
-- ---------------------------------------------------------------------
ALTER TABLE clover_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON clover_webhook_events FROM anon, authenticated;

-- No policies => only service role (bypasses RLS) may read/write.

-- ---------------------------------------------------------------------
-- L. Phase 2G TODO — column-level mirror write guards (not implemented here)
-- ---------------------------------------------------------------------
-- TODO(Phase 2G): BEFORE UPDATE trigger on products for Clover-owned columns
--   when effective_clover_sync_mode() IN ('clover_readonly','clover_primary').
-- TODO(Phase 2G): Same for categories, product_barcodes, inventory quantity.
-- TODO(Phase 2G): Block client INSERT/DELETE on mirror rows outside local_dev.
-- Intentionally omitted in 0003 so Phase 2A–2C local-dev writes keep working.

COMMIT;
