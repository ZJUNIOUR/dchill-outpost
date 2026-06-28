# Admin dashboard (`@dchill/admin`)

Staff-facing **React + Vite + TypeScript** web app for DChill Outpost.

## Scope

Operational dashboard: products, inventory, pricing, barcodes, pickup orders, customers, pickup rules, notifications, users/roles, reports, and settings. Access is gated by role + RLS — UI hiding alone is never sufficient.

## Clover-primary inventory (locked decision)

**Clover** is the source of truth for products, categories, prices, barcodes, and stock.
**Supabase** stores the synced mirror for app queries, RLS, search, and app-specific metadata.

- Client apps (including this admin app) **never call Clover directly**.
- Clover credentials and tokens are **server-only** (Edge Functions / `clover_credentials`).
- **Production path:** admin UI → Supabase Edge Function → Clover API → Supabase mirror + `inventory_logs`.
- See `docs/MEMORY.md` §6a and `docs/TECHNICAL_ARCHITECTURE.md` §6.

## Phase 2A–2C — Temporary local-dev admin foundation

Direct Supabase write helpers in `src/inventory/index.ts` are **not final production
inventory behavior**. They exist for local development and UI scaffolding only.

| Helper | Temporary direct write |
|--------|------------------------|
| `createProduct` / `updateProduct` / `setProductActive` | `products` |
| `createCategory` / `updateCategory` / `setCategoryActive` | `categories` |
| `addProductBarcode` / `updateProductBarcode` / `deleteProductBarcode` | `product_barcodes` |
| `updateInventoryQuantity` | `inventory` upsert (no log) |
| `adjustInventoryQuantityWithLog` / `createInventoryLog` | `inventory` + `inventory_logs` (non-atomic) |

**Warning:** Direct Supabase stock and catalog writes bypass Clover. Do not treat mirrored
rows as production POS truth until Phase 2F sync and Phase 2G write-through Edge Functions
are live. Production admin mutations will route through `clover-create-or-update-item` and
`clover-update-stock`.

Read helpers (`listProducts`, `listCategories`, `listInventoryRecords`, `listInventoryLogs`, etc.)
are appropriate for displaying the **Supabase mirror** once synced.

### Phase 2A — Inventory foundation

Product list, basic create/edit, and raw inventory quantity updates.

### Phase 2B — Categories & barcodes

Category management and manual product barcode CRUD (no camera scanner).

### Phase 2C — Inventory logs & adjustments

Inventory history visibility and stock adjustments that write `inventory_logs` rows.

**Key files:**

- `src/inventory/index.ts` — Supabase data helpers (anon client only; writes are temporary)
- `src/pages/InventoryPage.tsx` — inventory UI
- `src/components/inventory/*` — tables, forms, managers
- `src/auth/usePermissions.ts` — permission hints for UI gating

**What it does today:**

- **Products / categories / barcodes:** list + direct Supabase CRUD (temporary)
- **Inventory counts:** list on-hand/reserved quantities (staff-only mirror reads)
- **Adjustments:** set on-hand qty with `manual` or `restock` reason + optional note (direct Supabase — temporary)
- **History:** read append-only `inventory_logs`

### Atomic adjustment limitation (Phase 2C)

`adjustInventoryQuantityWithLog()` updates `inventory` and inserts `inventory_logs` as **two separate anon-client requests**. Production will use Edge Functions + DB RPC for Clover-first, atomic mirror+log updates.

### Required permissions (UI hints)

| Action | Permission key | Notes |
|--------|----------------|-------|
| View products / categories | `products.read` | Hides catalog UI if missing |
| Create/edit products | `products.write` | RLS also requires this (or `prices.write` for some price edits) |
| Create/edit categories | `products.write` | RLS `categories_write` policy |
| View raw inventory + logs | `inventory.read` | RLS log SELECT uses `is_staff_or_above()`; customers never see counts |
| Update quantities / insert logs | `inventory.write` | RLS `inventory_write` + `inv_logs_insert` |
| Add/edit/delete barcodes | `barcodes.manage` | RLS `barcodes_write` policy |

**RLS is authoritative.** Permission checks in the UI are convenience only — Postgres policies enforce every query and mutation.

**What it does not do yet:** Clover sync/write-through, camera/scanner UI, customer catalog, images, orders, notifications, reports.

## Environment variables

Copy `apps/admin/.env.example` → `apps/admin/.env` and set:

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_SUPABASE_URL` | Yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes | Supabase anon (public) key |

The app throws at startup if these are missing. Do not put the service-role key or Clover secrets in this file.

## Run locally

From the repository root (after `npm install` at root):

```bash
npm run dev -w @dchill/admin
```

Or from `apps/admin`:

```bash
npm run dev
```

- **Login:** http://localhost:5173/login
- **Dashboard:** http://localhost:5173/dashboard
- **Inventory:** http://localhost:5173/inventory

Other scripts:

```bash
npm run build -w @dchill/admin    # typecheck + production build
npm run typecheck -w @dchill/admin
```

## Security

- Clients use the **anon key only** — never the service-role key.
- **Clover secrets** are server-only (Edge Functions).
- **RLS** is the real security layer; UI role/permission checks are convenience only.

See `docs/USER_ROLES.md`, `docs/TECHNICAL_ARCHITECTURE.md`, and `docs/BUILD_ORDER.md`.
