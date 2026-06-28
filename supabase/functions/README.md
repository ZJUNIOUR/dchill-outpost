# Supabase Edge Functions — DChill Outpost

Server-side Deno functions for Clover integration, notifications, and privileged operations.

**Phase 2F scope:** read-only Clover inventory sync scaffolding only. No Clover write endpoints, no checkout, no webhooks yet.

## Layout

| Path | Purpose |
|------|---------|
| `_shared/` | Shared utilities (auth, Clover GET client, Supabase service client, mapping) |
| `clover-sync-catalog/` | Clover → Supabase categories, products, barcodes (GET-only) |
| `clover-sync-inventory/` | Clover → Supabase stock mirror + `inventory_logs` (GET-only) |

Client apps (mobile, admin) **never** call Clover directly. They may invoke these functions with a staff JWT; functions use the **service role** for mirror writes.

## Required secrets (Supabase project / Edge Function env only)

Set in the Supabase Dashboard → Edge Functions → Secrets, or `supabase secrets set`. **Do not** add these to `.env.example` or client bundles.

| Secret | Required | Description |
|--------|----------|-------------|
| `SUPABASE_URL` | Yes | Auto-injected by Supabase |
| `SUPABASE_ANON_KEY` | Yes | For JWT validation via `auth.getUser()` |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role — mirror writes + role re-check |
| `CLOVER_ENV` | Yes | `sandbox` or `production` |
| `CLOVER_MERCHANT_ID` | Yes | Merchant id (`mId`) — non-secret identifier |
| `CLOVER_ACCESS_TOKEN` | Yes | **Server-only** merchant API token for read sync |
| `CLOVER_SYNC_CRON_SECRET` | Optional | Bearer token for scheduled/cron invocations |
| `ALLOWED_ORIGIN` | Optional | CORS origin for admin triggers (default `*`) |

Future phases may add OAuth refresh secrets and `clover_credentials` reads — not used in Phase 2F scaffold.

## Sandbox vs production

| `CLOVER_ENV` | Clover API base URL |
|--------------|---------------------|
| `sandbox` (default) | `https://apisandbox.dev.clover.com` |
| `production` | `https://api.clover.com` |

Use a **Clover sandbox merchant** to validate field mapping before production. No real credentials belong in this repository.

## Phase 2F — read-only sync only

These functions:

- Use **GET** Clover endpoints only (`/categories`, `/items`, `/item_stocks`)
- Upsert the Supabase mirror (`categories`, `products`, `product_barcodes`, `inventory`)
- Append `clover_sync_runs` rows and `inventory_logs` with `source = clover_sync`
- Return **summary JSON only** — never raw Clover payloads or tokens

These functions do **not**:

- POST/PUT/PATCH/DELETE to Clover
- Expose `CLOVER_ACCESS_TOKEN` or webhook payloads to clients
- Replace Phase 2G write-through admin mutations

## Authentication

Each sync function accepts:

1. **Staff JWT** — `Authorization: Bearer <supabase_access_token>`  
   Re-validates `users.role` and `role_permissions` server-side (never trusts UI).

2. **Cron secret** — `Authorization: Bearer <CLOVER_SYNC_CRON_SECRET>`  
   For `pg_cron` or external schedulers.

## Invoke locally (after secrets are set)

```bash
supabase functions serve clover-sync-catalog --env-file supabase/.env.local
curl -X POST http://localhost:54321/functions/v1/clover-sync-catalog \
  -H "Authorization: Bearer <staff_jwt>"
```

## Clover field mapping assumptions (validate in sandbox)

Mapping helpers live in `_shared/syncMapping.ts` with conservative optional types.

| Clover | Supabase | Notes |
|--------|----------|-------|
| `categories[].id` | `categories.clover_category_id` | Upsert by Clover id |
| `categories[].name` | `categories.name` | |
| `categories[].sortOrder` | `categories.sort_order` | |
| `categories[].modifiedTime` | `categories.clover_modified_at` | Unix ms → ISO |
| `items[].id` | `products.clover_item_id` | Upsert by Clover id |
| `items[].name` | `products.name` | |
| `items[].price` (cents) | `products.base_price` | ÷ 100, `numeric(10,2)` |
| `items[].sku` | `products.sku` | |
| `items[].hidden` | `products.status` | `hidden` vs `in_stock` |
| `items[].categories[0]` | `products.category_id` | First category only — **TODO:** multi-category |
| `items[].code` | `product_barcodes.barcode` | **TODO:** confirm UPC vs internal code |
| `items[].alternateCodes[]` | `product_barcodes` | `clover_alternate_code_id` when id present |
| `item_stocks[].item.id` | match `products.clover_item_id` | Skip if no mirror row |
| `item_stocks[].quantity` | `inventory.quantity_on_hand` | Prefer over deprecated `stockCount` |

## Response shape (safe summary)

```json
{
  "ok": true,
  "run_id": "uuid",
  "run_type": "catalog",
  "status": "succeeded",
  "records_upserted": 42,
  "records_failed": 0
}
```

Staff can read `clover_sync_runs` via RLS; webhook payloads remain service-role only.

## Security

- Service role and Clover tokens stay in Edge Function runtime env only.
- Owner / Technology Specialist rules unchanged — functions do not manage users.
- RLS remains authoritative for client reads; mirror writes use service role inside functions.

See `AGENTS.md`, `docs/MEMORY.md` §6a, and `docs/TECHNICAL_ARCHITECTURE.md`.
