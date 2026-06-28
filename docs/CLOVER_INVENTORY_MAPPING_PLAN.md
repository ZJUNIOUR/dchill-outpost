# Clover inventory mapping migration plan (Phase 2E)

**Status:** Plan only — **not implemented.**  
**Proposed migration file:** `supabase/migrations/0003_clover_inventory_mapping.sql` (create in Phase 2E implementation, after owner review).

**Locked architecture (`docs/MEMORY.md` §6a):** Clover is the source of truth for products, categories, prices, barcodes, and stock. Supabase is the synced mirror, RLS layer, and app data store (users, roles, orders, carts, notifications, app metadata). Client apps never call Clover directly.

---

## 1. Audit verdict

| Area | Verdict |
|------|---------|
| Existing Clover product/inventory columns | **PASS** — partial mapping present |
| Category/barcode/log/sync observability | **WARN** — gaps block reliable sync |
| `clover_sync_mode` semantics vs Clover-primary | **WARN** — legacy values ambiguous |
| RLS on secrets (`clover_credentials`) | **PASS** — zero-row pattern proven |
| Direct client catalog/inventory writes | **WARN** — allowed today; needs mode guard |
| Security test impact | **WARN** — new tables need verification entries |

**Overall Phase 2E plan readiness:** **WARN** (safe to proceed with proposed migration after review; no blockers if RLS rules below are followed).

---

## 2. Current Clover-related schema (audit)

### 2.1 Catalog mirror

| Table | Column | Present | Notes |
|-------|--------|---------|-------|
| `products` | `clover_item_id` | ✅ | UNIQUE; indexed (`idx_products_clover`) |
| `products` | `clover_sync_status` | ✅ | `local_only \| synced \| pending \| error \| conflict` |
| `products` | `last_synced_at` | ✅ | timestamptz |
| `categories` | `clover_category_id` | ❌ | **Missing** — required for category sync |
| `product_barcodes` | Clover mapping | ❌ | **Missing** — optional `clover_alternate_code_id` recommended |
| `inventory` | `clover_item_id` | ❌ | **Not needed** — 1:1 with `products` via `product_id` PK; stock sync keys off `products.clover_item_id` |
| `inventory` | `clover_sync_status` | ✅ | Missing `conflict` vs products — **align in migration** |
| `inventory` | `last_synced_at` | ✅ | |

### 2.2 System / credentials

| Object | Purpose | RLS today |
|--------|---------|-----------|
| `system_settings.clover_sync_mode` | Sync behavior | Staff read; `settings.system` for Clover fields (trigger) |
| `system_settings.clover_merchant_id` | Non-secret mId | Same |
| `system_settings.payment_provider` | Default `clover` | Same |
| `clover_credentials` | Encrypted OAuth tokens | RLS on, **no policies**, REVOKE from `authenticated` |

### 2.3 Orders / payments (out of Phase 2E scope but mapped)

| Table | Clover fields |
|-------|----------------|
| `pickup_orders` | `clover_order_id`, `clover_sync_status` (future order mirror) |
| `payments` | `clover_checkout_session_id`, `clover_payment_id` (payments P0) |

### 2.4 Edge Functions

None implemented yet (`supabase/functions/` empty). Migration must not assume functions exist.

---

## 3. Missing fields & new tables (proposed)

### 3.1 Column additions

| Table | Column | Type | Purpose |
|-------|--------|------|---------|
| `categories` | `clover_category_id` | `TEXT UNIQUE` | Upsert categories from Clover |
| `categories` | `clover_sync_status` | `TEXT NOT NULL DEFAULT 'local_only'` | Match product sync vocabulary |
| `categories` | `last_synced_at` | `TIMESTAMPTZ` | |
| `categories` | `clover_modified_at` | `TIMESTAMPTZ` | Conflict detection (Clover `modifiedTime`) |
| `product_barcodes` | `clover_alternate_code_id` | `TEXT UNIQUE` | If Clover API returns distinct code entity id; nullable |
| `product_barcodes` | `clover_sync_status` | `TEXT NOT NULL DEFAULT 'local_only'` | Optional; skip if barcode string is sufficient key |
| `products` | `clover_modified_at` | `TIMESTAMPTZ` | Conflict detection |
| `inventory_logs` | `source` | `TEXT NOT NULL DEFAULT 'app'` | `app \| clover_sync \| edge_function \| order_flow` |
| `inventory_logs` | `external_ref` | `TEXT` | Clover event id, Edge Function idempotency key, or stock event ref |
| `inventory` | (no `clover_item_id`) | — | Document: use `products.clover_item_id` |

**Align enums-as-TEXT:** Add `conflict` to documented `inventory.clover_sync_status` comment/check if a CHECK is added.

### 3.2 New tables

#### `clover_sync_runs` (operational observability — no secrets)

Append-only job history for sync Edge Functions.

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID PK` | |
| `run_type` | `TEXT NOT NULL` | `catalog \| inventory \| webhook \| full` |
| `status` | `TEXT NOT NULL` | `running \| succeeded \| failed \| partial` |
| `merchant_id` | `TEXT` | Matches `clover_merchant_id` |
| `started_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `finished_at` | `TIMESTAMPTZ` | |
| `records_upserted` | `INT NOT NULL DEFAULT 0` | |
| `records_failed` | `INT NOT NULL DEFAULT 0` | |
| `error_summary` | `TEXT` | No stack traces / tokens |
| `triggered_by` | `TEXT NOT NULL` | `cron \| webhook \| manual \| edge_function` |

#### `clover_webhook_events` (idempotency + debug — **may contain sensitive payload**)

| Column | Type | Notes |
|--------|------|-------|
| `id` | `UUID PK` | |
| `clover_event_id` | `TEXT NOT NULL UNIQUE` | Idempotency anchor |
| `event_type` | `TEXT NOT NULL` | |
| `merchant_id` | `TEXT` | |
| `payload` | `JSONB` | **Service-role only** — never expose to clients |
| `received_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | |
| `processed_at` | `TIMESTAMPTZ` | |
| `status` | `TEXT NOT NULL DEFAULT 'pending'` | `pending \| processed \| failed \| ignored` |
| `sync_run_id` | `UUID REFERENCES clover_sync_runs(id)` | Optional |

**Optional view (later):** `clover_webhook_events_summary` — `id`, `event_type`, `status`, `received_at` for staff dashboards without `payload`.

---

## 4. `clover_sync_mode` recommendation

### Current values (`DATABASE_SCHEMA.sql`)

`payments_only` | `catalog_oneway` | `full`

These predate the Clover-primary locked decision and are ambiguous.

### Recommended approach (safest — additive, no breaking drop in `0003`)

**Extend** the CHECK constraint to include **new canonical modes** while **keeping legacy values** for one release:

| Mode | Meaning |
|------|---------|
| `local_dev` | **Phase 2A–2C behavior.** Direct Supabase catalog/inventory writes allowed. For local/staging only. |
| `clover_readonly` | Clover→Supabase sync enabled; **no direct client writes** to Clover-owned mirror columns. App-only metadata (`is_featured`, etc.) still writable per RLS. |
| `clover_primary` | Production: admin mutations **only** via Edge Functions (Clover first, then mirror). |
| `payments_only` | **Legacy:** payments sync only; treat as `local_dev` until catalog sync is configured. |
| `catalog_oneway` | **Legacy alias:** map operationally to `clover_readonly`. |
| `full` | **Legacy alias:** map to `clover_primary` (includes future order mirror). |

**Do not** remove legacy values in `0003`. Add a follow-up migration (`0004_…`) to deprecate after Edge Functions ship.

**Production default after Phase 2F:** `clover_readonly` → then `clover_primary` after Phase 2G write-through is proven.  
**Local dev seed:** `local_dev`.

Helper function (proposed in `0003`):

```sql
-- Normalizes legacy mode names for triggers/policies.
CREATE OR REPLACE FUNCTION effective_clover_sync_mode()
RETURNS TEXT ...
  -- maps catalog_oneway -> clover_readonly, full -> clover_primary, payments_only -> local_dev (or keep payments_only as separate if merchant has no Clover catalog yet)
```

**Recommendation:** `payments_only` remains valid for “Clover payments wired, catalog not yet synced” and blocks customer catalog launch checks; `local_dev` is explicit dev override.

---

## 5. Proposed `0003_clover_inventory_mapping.sql` (SQL sketch — do not apply yet)

```sql
-- 0003_clover_inventory_mapping.sql
-- Forward-only. Clover-primary mirror mapping. Does NOT weaken Owner/TS protection.

BEGIN;

-- ---------------------------------------------------------------------
-- A. categories: Clover mapping
-- ---------------------------------------------------------------------
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS clover_category_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS clover_sync_status TEXT NOT NULL DEFAULT 'local_only',
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS clover_modified_at TIMESTAMPTZ;

COMMENT ON COLUMN categories.clover_category_id IS 'Clover category id (POS source of truth).';
CREATE INDEX IF NOT EXISTS idx_categories_clover ON categories(clover_category_id)
  WHERE clover_category_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- B. products: conflict detection
-- ---------------------------------------------------------------------
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS clover_modified_at TIMESTAMPTZ;

COMMENT ON COLUMN products.clover_modified_at IS 'Last known Clover modifiedTime for conflict detection.';

-- ---------------------------------------------------------------------
-- C. product_barcodes: optional Clover code entity id
-- ---------------------------------------------------------------------
ALTER TABLE product_barcodes
  ADD COLUMN IF NOT EXISTS clover_alternate_code_id TEXT UNIQUE;

COMMENT ON COLUMN product_barcodes.clover_alternate_code_id IS
  'Clover alternate code id when distinct from barcode string; nullable.';

-- ---------------------------------------------------------------------
-- D. inventory_logs: provenance
-- ---------------------------------------------------------------------
ALTER TABLE inventory_logs
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'app',
  ADD COLUMN IF NOT EXISTS external_ref TEXT;

COMMENT ON COLUMN inventory_logs.source IS 'app | clover_sync | edge_function | order_flow';
COMMENT ON COLUMN inventory_logs.external_ref IS 'Clover event id or Edge Function idempotency key.';

CREATE INDEX IF NOT EXISTS idx_inventory_logs_external_ref
  ON inventory_logs(external_ref) WHERE external_ref IS NOT NULL;

-- ---------------------------------------------------------------------
-- E. inventory: align sync status vocabulary (comment + optional CHECK later)
-- ---------------------------------------------------------------------
COMMENT ON COLUMN inventory.clover_sync_status IS
  'local_only | synced | pending | error | conflict (align with products)';

-- ---------------------------------------------------------------------
-- F. system_settings: extend clover_sync_mode (additive)
-- ---------------------------------------------------------------------
ALTER TABLE system_settings DROP CONSTRAINT IF EXISTS system_settings_clover_sync_mode_check;
ALTER TABLE system_settings ADD CONSTRAINT system_settings_clover_sync_mode_check
  CHECK (clover_sync_mode IN (
    'payments_only', 'catalog_oneway', 'full',          -- legacy
    'local_dev', 'clover_readonly', 'clover_primary'   -- canonical
  ));

COMMENT ON COLUMN system_settings.clover_sync_mode IS
  'local_dev=direct Supabase writes; clover_readonly=sync in; clover_primary=write-through Edge Functions. Legacy values retained.';

-- ---------------------------------------------------------------------
-- G. clover_sync_runs
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
    CHECK (run_type IN ('catalog','inventory','webhook','full')),
  CONSTRAINT clover_sync_runs_status_check
    CHECK (status IN ('running','succeeded','failed','partial'))
);

CREATE INDEX IF NOT EXISTS idx_clover_sync_runs_started ON clover_sync_runs(started_at DESC);

-- ---------------------------------------------------------------------
-- H. clover_webhook_events (payload = service-role only)
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
  sync_run_id     UUID REFERENCES clover_sync_runs(id),
  CONSTRAINT clover_webhook_events_status_check
    CHECK (status IN ('pending','processed','failed','ignored'))
);

CREATE INDEX IF NOT EXISTS idx_clover_webhook_events_received ON clover_webhook_events(received_at DESC);

-- ---------------------------------------------------------------------
-- I. RLS: new tables (in 0003 OR companion 0003_rls patch — prefer same migration)
-- ---------------------------------------------------------------------
ALTER TABLE clover_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE clover_webhook_events ENABLE ROW LEVEL SECURITY;

-- Staff may read sync run summaries (no secrets in this table).
CREATE POLICY clover_sync_runs_read ON clover_sync_runs FOR SELECT
  USING ( is_staff_or_above() );
-- Inserts/updates: service role only (no INSERT/UPDATE policy for authenticated).

-- Webhook table: mirror clover_credentials — NO policies for authenticated.
REVOKE ALL ON clover_webhook_events FROM anon, authenticated;

-- clover_sync_runs: allow authenticated SELECT only via policy; no write grants.
REVOKE INSERT, UPDATE, DELETE ON clover_sync_runs FROM anon, authenticated;
GRANT SELECT ON clover_sync_runs TO authenticated;

-- ---------------------------------------------------------------------
-- J. Mirror write guard (when not local_dev)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION protect_clover_mirror_catalog_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  mode TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;  -- service/migration
  SELECT clover_sync_mode INTO mode FROM system_settings LIMIT 1;
  IF mode IN ('local_dev', 'payments_only') THEN RETURN NEW; END IF;
  -- clover_readonly / clover_primary: block direct client INSERT/UPDATE/DELETE
  -- on Clover-owned tables. Edge Functions use service role (auth.uid() IS NULL) or
  -- a dedicated SECURITY DEFINER upsert function with bypass flag.
  RAISE EXCEPTION 'Direct catalog/inventory mirror writes are disabled in clover_sync_mode=%. Use Clover Edge Functions.', mode;
END $$;

-- Apply to products, categories, product_barcodes, inventory FOR authenticated paths.
-- NOTE: Implement carefully — may block legitimate app-only column updates on products.
-- SAFER VARIANT (recommended for 0003): split trigger into:
--   (1) block INSERT/DELETE on mirror tables when mode not local_dev
--   (2) block UPDATE only on Clover-owned columns via column-level trigger
-- App-only columns (is_featured, substitution_allowed) remain updatable in clover_readonly.

CREATE OR REPLACE FUNCTION protect_clover_owned_product_columns()
RETURNS trigger LANGUAGE plpgsql ...;
  -- IF mode NOT IN (local_dev, payments_only) AND (
  --   NEW.name IS DISTINCT FROM OLD.name OR NEW.base_price ... ) THEN RAISE ...

-- inventory_logs INSERT from clients: disallow when clover_primary except via RPC.

COMMIT;
```

**Important:** The mirror-write guard in section J is **high risk** if implemented as a blanket table lock. **Recommended for 0003:** ship **column-level** guards on Clover-owned fields only; defer blanket INSERT/DELETE block to Phase 2G when Edge Functions exist. Document in implementation ticket.

---

## 6. Proposed RLS / security rules (summary)

| Object | SELECT | INSERT/UPDATE/DELETE |
|--------|--------|----------------------|
| `clover_credentials` | No app access (unchanged) | Service role only |
| `clover_webhook_events` | **No app access** | Service role only |
| `clover_sync_runs` | `is_staff_or_above()` | Service role only |
| `categories` / `products` / `inventory` / `barcodes` | Existing policies (unchanged in 0003) | Existing + optional column guards |
| `inventory_logs` | Staff (`inv_logs_read`) | Insert via `inventory.write` or service role; add `source`/`external_ref` |

**Grants to add (mirror `0002_complete_rls_policies.sql` patterns):**

```sql
GRANT SELECT ON clover_sync_runs TO authenticated;
REVOKE ALL ON clover_webhook_events FROM anon, authenticated;
-- Do NOT GRANT SELECT on clover_webhook_events to authenticated.
```

---

## 7. Proposed verification / test updates

### `0002_rls_verification.sql` (new migration companion or append new file `0003_rls_verification_clover.sql`)

| Test | Assertion |
|------|-----------|
| T-RLS-new-1 | `clover_sync_runs` has RLS enabled |
| T-RLS-new-2 | `clover_webhook_events` has RLS enabled |
| T-RLS-new-3 | `clover_webhook_events` = **0 rows** for all app roles + anon (like `clover_credentials`) |
| T-RLS-new-4 | Staff can `SELECT` from `clover_sync_runs` (≥0 rows ok) |
| T-RLS-new-5 | `authenticated` cannot `INSERT` into `clover_webhook_events` |

Add tables to the “must have RLS enabled” fixture list.

### `test_technology_specialist_rbac.sql`

**Likely no change** unless new permissions are introduced. Optional assertion:

- TS **cannot** read `clover_webhook_events` (0 rows).

Do **not** weaken existing Owner/TS tests.

---

## 8. Proposed TypeScript / admin updates (post-migration, not in 0003 file)

### `packages/types/src/index.ts`

- `Category`: add `clover_category_id`, `clover_sync_status`, `last_synced_at`, `clover_modified_at`
- `Product`: add `clover_modified_at`
- `ProductBarcode`: add `clover_alternate_code_id?`
- `InventoryLog`: add `source`, `external_ref`
- New: `CloverSyncMode`, `CloverSyncRun`, `CloverSyncStatus` (row-level status enum-as-union)
- `INVENTORY_LOG_SOURCES` const

### `apps/admin/src/inventory/index.ts`

- Select new columns in queries
- Display `clover_sync_status`, `clover_item_id`, `last_synced_at` in admin tables
- **Do not** add Clover API calls
- Gate direct write helpers: if `clover_sync_mode` ∉ `local_dev|payments_only`, show error / hide write UI (client convenience; DB trigger is authority)

### `docs/TECHNICAL_ARCHITECTURE.md`

- Reference `0003` mapping columns and sync run tables
- Document `effective_clover_sync_mode()` and mirror-write guards

### `apps/admin/README.md`

- Document sync status columns and mode banner
- Link to this plan

---

## 9. Risks

| Risk | Mitigation |
|------|------------|
| Breaking security tests | Add tests before enabling strict triggers; keep `0002` suite green |
| Exposing webhook `payload` | REVOKE + no RLS policies; verification T-RLS-new-3 |
| Clients mutating mirror directly | Column-level triggers + `clover_readonly`/`clover_primary` modes; admin UI warnings |
| Local vs Clover inventory conflict | `clover_sync_status=conflict`, `clover_modified_at` comparison; admin conflict UI in Phase 2F |
| Customer catalog stale data | **Block Phase 3** until `clover_readonly` sync proven; reject `local_only` rows in customer queries (future policy or app check) |
| Blanket write trigger breaks `is_featured` edits | Use column-level guard, not table-level |
| Legacy `payments_only` installs | Additive CHECK only; document migration path |

---

## 10. Direct Supabase admin writes — recommendation

| `clover_sync_mode` | Direct Supabase writes (Phase 2A–2C helpers) |
|--------------------|-----------------------------------------------|
| `local_dev` | **Allowed** — local/staging only; banner in admin UI |
| `payments_only` | **Allowed** until catalog sync is configured (transitional) |
| `clover_readonly` | **Blocked** for Clover-owned columns; app-only metadata OK |
| `clover_primary` | **Blocked** — Edge Functions only |
| Legacy `catalog_oneway` | Treated as `clover_readonly` |
| Legacy `full` | Treated as `clover_primary` |

**Labeling:** Admin inventory page shows persistent banner:

> “Direct Supabase writes are enabled (`local_dev`). Production uses Clover write-through.”

**Guarding:** DB triggers (column-level) + optional Edge Function path in Phase 2G. UI gating is courtesy only.

---

## 11. Implementation rollout order

```
Phase 2E (this plan)     → owner review of CLOVER_INVENTORY_MAPPING_PLAN.md
Phase 2E-impl            → apply 0003_clover_inventory_mapping.sql + RLS verification append
Phase 2E-types           → packages/types + admin selects (read-only new columns)
Phase 2F                 → clover-token-refresh, clover-sync-catalog/inventory/webhook
                         → populate mapping columns; clover_sync_mode → clover_readonly
Phase 2G                 → clover-create-or-update-item, clover-update-stock, RPC atomic log
                         → clover_sync_mode → clover_primary; strict write guards
Phase 3                  → customer catalog (mirror reads only; sync freshness checks)
```

### Per-step checklist

1. **Migration `0003`** — columns + tables + grants + RLS enablement (no blanket trigger until 2G).
2. **RLS verification SQL** — new table tests; CI green.
3. **Types** — align with new columns.
4. **Admin UI** — read sync fields + mode banner; no Clover API.
5. **Edge Functions (2F)** — service role writes mirror + `clover_sync_runs`.
6. **Write-through (2G)** — replace direct write helpers; enable column guards.
7. **Customer catalog (3)** — only after sync health checks pass.

---

## 12. What this plan explicitly does NOT do

- Does not modify `DATABASE_SCHEMA.sql` (shipped baseline)
- Does not modify `0002_complete_rls_policies.sql` (apply changes in forward `0003` migration)
- Does not implement Edge Functions
- Does not add secrets to `.env.example`
- Does not introduce delivery, Stripe, customer catalog, scanner, or checkout

---

## 13. Sign-off checklist (before applying `0003`)

- [ ] Owner approves `clover_sync_mode` canonical values
- [ ] Owner approves `clover_webhook_events` service-role-only pattern
- [ ] Confirm column-level vs table-level mirror guard approach
- [ ] `npm run test:security` plan includes new assertions
- [ ] Phase 2F engineer has Clover sandbox merchant + category/item API samples for field mapping validation
