# Admin dashboard (`@dchill/admin`)

Staff-facing **React + Vite + TypeScript** web app for DChill Outpost.

## Scope

Operational dashboard: products, inventory, pricing, barcodes, pickup orders, customers, pickup rules, notifications, users/roles, reports, and settings. Access is gated by role + RLS — UI hiding alone is never sufficient.

## Phase 2A — Inventory foundation

Product list, basic create/edit, and raw inventory quantity updates.

## Phase 2B — Categories & barcodes

Extends the inventory page with category management and manual product barcode CRUD (no camera scanner).

**Key files:**

- `src/inventory/index.ts` — Supabase data helpers (anon client only)
- `src/pages/InventoryPage.tsx` — inventory UI
- `src/components/inventory/CategoryManager.tsx` — category list + create/edit/active
- `src/components/inventory/ProductBarcodeManager.tsx` — barcode list/add/edit/delete per product
- `src/auth/usePermissions.ts` — permission hints for UI gating

**What it does:**

- **Products:** list, create/edit, toggle visibility (`hidden` vs visible statuses)
- **Categories:** list, create/edit, activate/deactivate (`is_active`)
- **Barcodes:** list per product, add/edit/delete rows in `product_barcodes` (`barcode`, `is_primary`)
- **Inventory:** list and update on-hand counts (staff-only raw counts)

**Schema note:** `product_barcodes` has no `barcode_type` column — only `barcode` (unique) and `is_primary`.

**What it does not do yet:** camera/scanner UI, customer catalog, images, Clover sync, orders, notifications, reports.

### Required permissions (UI hints)

| Action | Permission key | Notes |
|--------|----------------|-------|
| View products / categories | `products.read` | Hides catalog UI if missing |
| Create/edit products | `products.write` | RLS also requires this (or `prices.write` for some price edits) |
| Create/edit categories | `products.write` | RLS `categories_write` policy uses `products.write` |
| View raw inventory counts | `inventory.read` | Customers never see these in the mobile app |
| Update quantities | `inventory.write` | Upserts `public.inventory` rows |
| Add/edit/delete barcodes | `barcodes.manage` | RLS `barcodes_write` policy |

**RLS is authoritative.** Permission checks in the UI are convenience only — Postgres policies enforce every query and mutation. If RLS denies an action, the UI shows the database error (including explicit RLS denial messages).

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
