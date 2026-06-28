# Admin dashboard (`@dchill/admin`)

Staff-facing **React + Vite + TypeScript** web app for DChill Outpost.

## Scope

Operational dashboard: products, inventory, pricing, barcodes, pickup orders, customers, pickup rules, notifications, users/roles, reports, and settings. Access is gated by role + RLS — UI hiding alone is never sufficient.

## Phase 2A — Inventory foundation

Product list, basic create/edit, and raw inventory quantity updates.

## Phase 2B — Categories & barcodes

Category management and manual product barcode CRUD (no camera scanner).

## Phase 2C — Inventory logs & adjustments

Inventory history visibility and stock adjustments that write `inventory_logs` rows.

**Key files:**

- `src/inventory/index.ts` — Supabase data helpers (anon client only)
- `src/pages/InventoryPage.tsx` — inventory UI
- `src/components/inventory/InventoryLogTable.tsx` — log history + product filter
- `src/components/inventory/InventoryAdjustmentForm.tsx` — adjust qty with reason/note
- `src/auth/usePermissions.ts` — permission hints for UI gating

**What it does:**

- **Products / categories / barcodes:** (Phase 2A–2B)
- **Inventory counts:** list on-hand/reserved quantities (staff-only)
- **Adjustments:** set new on-hand qty with `manual` or `restock` reason + optional note
- **History:** read append-only `inventory_logs` (change, new qty, reason, actor, timestamp)

**Schema (`inventory_logs`):** `id`, `product_id`, `change_qty`, `new_quantity`, `reason` (TEXT), `user_id`, `order_id`, `created_at`. No separate note column — notes are appended to `reason` (e.g. `manual: damaged units removed`). No `barcode_type` or adjustment enum in the database.

### Atomic adjustment limitation

`adjustInventoryQuantityWithLog()` updates `inventory` and inserts `inventory_logs` as **two separate anon-client requests**. If the log insert fails after the inventory row updates, the UI reports a partial failure. **Production order flows and guaranteed atomic stock changes require a future SECURITY DEFINER RPC or Edge Function** — not implemented in this phase.

`updateInventoryQuantity()` remains available for direct upserts without logging (Phase 2A); the inventory page uses the adjustment form with logging instead.

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

**What it does not do yet:** camera/scanner UI, customer catalog, images, Clover sync, orders, notifications, reports, atomic stock RPC.

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
