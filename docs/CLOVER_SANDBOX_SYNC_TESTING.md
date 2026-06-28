# Clover sandbox sync testing checklist (Phase 2F.5)

**Purpose:** Verify read-only Clover → Supabase sync is safe and ready for sandbox testing **before** Phase 2G write-through work.

**Scope:** `clover-sync-catalog` and `clover-sync-inventory` only. No Clover writes, no customer catalog, no checkout.

**Architecture reminder:** Clover is source of truth for catalog/stock. Supabase is the mirror + RLS layer. Client apps never call Clover.

---

## 1. Phase 2F.5 verification summary

| Area | Verdict | Notes |
|------|---------|-------|
| Secrets not in repo / `.env.example` | **PASS** | Tokens read via `Deno.env` only |
| Service role confined to Edge Functions | **PASS** | `createServiceClient()` in `_shared/supabaseAdmin.ts` only |
| No client imports of `_shared/` | **PASS** | Admin/mobile use anon Supabase client only |
| No raw Clover payloads to clients | **PASS** | Summary JSON only |
| Error sanitization (tokens/headers) | **PASS** | `sanitizeClientError()` strips Bearer/token patterns |
| Clover upstream error body in client errors | **WARN** | Up to 240 chars of Clover error JSON may appear — review in sandbox; tighten in 2G if needed |
| GET-only Clover API | **PASS** | `cloverGet()` uses `method: 'GET'` only |
| Staff JWT auth re-checks DB role/permissions | **PASS** | `users` + `role_permissions`; UI not trusted |
| Customer cannot trigger sync | **PASS** | `customer` / `guest` not in `STAFF_ROLES` |
| Cron path requires server secret | **PASS** | `CLOVER_SYNC_CRON_SECRET` exact Bearer match |
| Cron path when secret unset | **WARN** | Cron disabled if secret missing — document for schedulers |
| Field mapping validated in sandbox | **WARN** | Several assumptions need real sandbox payloads (see §5) |
| Conflict detection (`clover_sync_status=conflict`) | **WARN** | Not implemented — mirror always overwrites on sync |
| App-only product fields on re-sync | **WARN** | Full product row update may overwrite `is_featured`, etc. — address in 2G |

**Overall readiness:** **WARN** — safe to begin sandbox testing; resolve mapping TODOs before production or Phase 3 catalog.

---

## 2. Required Supabase Edge Function secrets (names only)

Set in Supabase Dashboard → Project Settings → Edge Functions → Secrets, or:

```bash
supabase secrets set CLOVER_ENV=sandbox
# ... other secrets — never commit values
```

| Secret name | Required | Purpose |
|-------------|----------|---------|
| `SUPABASE_URL` | Yes | Usually auto-injected |
| `SUPABASE_ANON_KEY` | Yes | JWT validation (`auth.getUser`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Mirror writes + role re-check |
| `CLOVER_ENV` | Yes | `sandbox` or `production` |
| `CLOVER_MERCHANT_ID` | Yes | Sandbox merchant id (`mId`) |
| `CLOVER_ACCESS_TOKEN` | Yes | Server-only merchant API token (sandbox) |
| `CLOVER_SYNC_CRON_SECRET` | Optional | Scheduled job Bearer token |
| `ALLOWED_ORIGIN` | Optional | CORS for admin triggers |

**Do not** add `CLOVER_ACCESS_TOKEN` or `SUPABASE_SERVICE_ROLE_KEY` to `.env.example` or any client `.env`.

For local `supabase functions serve`, use a **gitignored** file such as `supabase/.env.local` (not committed).

---

## 3. Clover sandbox merchant setup

1. Create or open a [Clover sandbox developer account](https://sandbox.dev.clover.com/).
2. Create a sandbox merchant (test store).
3. Note the **merchant id** (`mId`) → set as `CLOVER_MERCHANT_ID`.
4. Generate a **merchant API token** with inventory read permissions → set as `CLOVER_ACCESS_TOKEN` in Supabase secrets only.
5. Set `CLOVER_ENV=sandbox` (uses `https://apisandbox.dev.clover.com`).
6. In Supabase, apply migrations through `0003_clover_inventory_mapping.sql` on your project.
7. Optional: set `system_settings.clover_sync_mode` to `clover_readonly` after first successful sync (staff can read via admin banner).

---

## 4. Sample test data to create in Clover sandbox

Create these in the Clover sandbox dashboard (or sandbox API) **before** running sync:

| Entity | Suggested test values | What to verify in Supabase |
|--------|----------------------|----------------------------|
| **Category** | Name: `Sandbox Produce`, sort order if available | `categories.clover_category_id`, `clover_sync_status=synced`, `clover_modified_at` |
| **Item / product** | Name: `Sandbox Plantain`, price `$2.49`, assign to category | `products.clover_item_id`, `base_price`, `category_id` link |
| **SKU** | `SBX-PLANTAIN-001` on the item | `products.sku` |
| **Barcode / code** | UPC-style code on item + one alternate code if supported | `product_barcodes.barcode`, `clover_alternate_code_id` |
| **Stock** | Quantity `25` on the item | `inventory.quantity_on_hand`, `inventory_logs` with `source=clover_sync` |

After creating data, note Clover `id` values from the sandbox UI or a one-off GET (outside this repo) for spot-checking mirror rows.

---

## 5. Sync run order

```text
1. clover-sync-catalog   (categories → products → barcodes)
2. clover-sync-inventory (item_stocks → inventory + logs)
```

Inventory sync **skips** Clover items with no matching `products.clover_item_id`. Always run catalog first on a fresh project.

---

## 6. Supabase verification queries (staff / SQL editor)

Run as a privileged user or via admin UI after sync.

### Categories

- Row exists with `clover_category_id` = Clover category id
- `clover_sync_status` = `synced`
- `last_synced_at` and `clover_modified_at` populated when Clover returns `modifiedTime`

### Products

- Row exists with `clover_item_id` = Clover item id
- `base_price` matches Clover price (cents ÷ 100)
- `category_id` points at mirrored category (if Clover returns category association)

### Product barcodes

- Primary barcode from `item.code` (if present)
- Alternate rows from `alternateCodes` with `clover_alternate_code_id` when Clover provides ids

### Inventory

- `inventory.quantity_on_hand` matches Clover stock
- `clover_sync_status` = `synced`, `last_synced_at` set

### Inventory logs

- Row with `source = clover_sync`, `external_ref` like `clover_sync:{run_id}:{clover_item_id}`
- `change_qty` reflects delta from previous mirror quantity

### clover_sync_runs

- Staff can `SELECT` rows (RLS `is_staff_or_above()`)
- `run_type` = `catalog` or `inventory`
- `status` in `succeeded` | `partial` | `failed`
- `error_summary` has no tokens (generic messages only)

### Security: webhook / payload tables

- `clover_webhook_events`: **0 rows** for all app roles (verified by `0003_rls_verification_clover.sql`)
- No Edge Function response includes raw Clover JSON or tokens

### Admin UI

- **Inventory page** → `CloverSyncBanner` shows `clover_sync_mode` / merchant id (non-secret)
- **ProductTable** → Clover column shows item id or sync status
- **CategoryManager** → Clover category id or sync status
- **ProductBarcodeManager** → alternate code id when present
- **InventoryLogTable** → `source`, `external_ref` for sync rows

---

## 7. Manual test plan (no secrets in repo)

### A. Local (Supabase CLI)

1. Create `supabase/.env.local` (gitignored) with secret **values** (not committed).
2. Start functions:

   ```bash
   supabase functions serve clover-sync-catalog --env-file supabase/.env.local
   ```

3. Obtain a **staff** Supabase access token (sign in via admin app → copy session JWT from devtools, or use Supabase Auth API with test user).
4. Invoke:

   ```bash
   curl -s -X POST "http://127.0.0.1:54321/functions/v1/clover-sync-catalog" \
     -H "Authorization: Bearer <STAFF_ACCESS_TOKEN>" \
     -H "Content-Type: application/json"
   ```

5. Repeat for `clover-sync-inventory` after catalog succeeds.

### B. Deployed project

```bash
curl -s -X POST "https://<project-ref>.supabase.co/functions/v1/clover-sync-catalog" \
  -H "Authorization: Bearer <STAFF_ACCESS_TOKEN>" \
  -H "apikey: <SUPABASE_ANON_KEY>" \
  -H "Content-Type: application/json"
```

Use the same pattern for `/functions/v1/clover-sync-inventory`.

### C. Cron / scheduler (optional)

```bash
curl -s -X POST "https://<project-ref>.supabase.co/functions/v1/clover-sync-catalog" \
  -H "Authorization: Bearer <CLOVER_SYNC_CRON_SECRET>" \
  -H "apikey: <SUPABASE_ANON_KEY>"
```

Requires `CLOVER_SYNC_CRON_SECRET` set in Edge Function secrets.

### D. Expected success response (catalog)

```json
{
  "ok": true,
  "run_id": "uuid",
  "run_type": "catalog",
  "status": "succeeded",
  "records_upserted": 3,
  "records_failed": 0,
  "categories_upserted": 1,
  "products_upserted": 1,
  "barcodes_upserted": 1,
  "message": "Read-only catalog sync completed. Validate field mapping with Clover sandbox."
}
```

### E. Expected success response (inventory)

```json
{
  "ok": true,
  "run_id": "uuid",
  "run_type": "inventory",
  "status": "succeeded",
  "records_upserted": 1,
  "records_failed": 0,
  "stocks_skipped": 0,
  "message": "Read-only inventory sync completed. Unmatched Clover items are skipped until catalog sync runs."
}
```

### F. Expected failure responses

| Condition | HTTP | Body shape |
|-----------|------|------------|
| Missing / invalid JWT | 401 | `{ "ok": false, "error": "Unauthorized" }` |
| Customer JWT | 403 | `{ "ok": false, "error": "Forbidden — staff role required" }` |
| Missing Clover secrets | 500 | `{ "ok": false, "error": "CLOVER_ACCESS_TOKEN is not configured..." }` (no token value) |
| Clover API error | 4xx/5xx | `{ "ok": false, "error": "Clover API GET /items failed (401): ..." }` (sanitized) |

### G. Partial sync behavior

- If some rows fail upsert (e.g. unique `sku` collision): `status: "partial"`, `records_failed` > 0, `ok: true` when at least one row succeeded.
- If all rows fail: `status: "failed"`, `ok: false`.
- Check `clover_sync_runs.error_summary` for first few generic error lines (staff-readable via RLS).

### H. Negative auth tests

| Actor | Expected |
|-------|----------|
| Customer JWT | 403 Forbidden |
| Anon (no Bearer) | 401 Unauthorized |
| Staff without catalog/inventory/settings permission | 403 Forbidden |
| Invalid cron secret | 401 Unauthorized |

---

## 8. Mapping risks still unresolved (sandbox validation required)

| Risk | Severity | Action in sandbox |
|------|----------|-----------------|
| `GET /items` may need `expand=categories` for category link | High | Inspect raw item JSON; add expand in 2G if categories missing |
| `GET /items` may need `expand=alternateCodes` for barcodes | Medium | Confirm `code` / `alternateCodes` shape |
| `item.code` vs UPC vs internal SKU | Medium | Compare scanned barcode to mirrored `product_barcodes` |
| Multi-category items — only first category mapped | Low | Document or extend mapping later |
| Price always in cents | Low | Confirm `$2.49` → `2.49` in mirror |
| `modifiedTime` units (ms vs s) | Medium | Compare `clover_modified_at` to Clover UI |
| No `conflict` status on concurrent local + Clover edits | Medium | Phase 2G guards |
| Product update overwrites app-only columns | High | Phase 2G column-level merge |
| Duplicate `sku` across items breaks insert | Medium | Use unique SKUs in sandbox test data |

Code TODOs referencing these live in `supabase/functions/_shared/cloverClient.ts` and `syncMapping.ts`.

---

## 9. Sign-off before Phase 2G

- [ ] Catalog sync succeeded on sandbox merchant
- [ ] Inventory sync succeeded after catalog
- [ ] Mirror rows match spot-checked Clover entities
- [ ] `clover_sync_runs` visible to staff, not writable from client
- [ ] `clover_webhook_events` still blocked for app roles (CI green)
- [ ] No secrets in client bundles or git history from testing
- [ ] Mapping TODOs triaged with real sandbox payloads

---

## Related docs

- `supabase/functions/README.md` — function layout and secrets
- `docs/CLOVER_INVENTORY_MAPPING_PLAN.md` — schema mapping plan
- `docs/MEMORY.md` §6a — Clover-primary decision
- `docs/BUILD_ORDER.md` — Phase 2F → 2G → 3 ordering
