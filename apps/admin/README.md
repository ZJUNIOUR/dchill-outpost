# Admin dashboard (`@dchill/admin`)

Staff-facing **React + Vite + TypeScript** web app for DChill Outpost.

## Scope

Operational dashboard: products, inventory, pricing, barcodes, pickup orders, customers, pickup rules, notifications, users/roles, reports, and settings. Access is gated by role + RLS — UI hiding alone is never sufficient.

## Phase 1D — Auth-wired shell

Minimal Vite + React app with email/password sign-in and a placeholder dashboard. No operational features yet.

**Key files:**

- `src/main.tsx` — app entry
- `src/App.tsx` — routes (`/login`, `/dashboard`)
- `src/auth/AuthProvider.tsx`, `src/auth/useAuth.ts` — session context
- `src/auth/index.ts` — Supabase auth helpers
- `src/lib/supabase.ts` — anon-key client
- `src/pages/LoginPage.tsx`, `src/pages/DashboardPlaceholder.tsx`

**Security:**

- Clients use the **anon key only** — never the service-role key.
- **Clover secrets** are server-only (Edge Functions).
- **RLS** is the real security layer; UI role display is convenience only.

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
- **Dashboard (after sign-in):** http://localhost:5173/dashboard

Other scripts:

```bash
npm run build -w @dchill/admin    # typecheck + production build
npm run typecheck -w @dchill/admin
```

## Status

Phase 1D shell only — **no products, inventory, orders, or settings UI yet.**

See `docs/USER_ROLES.md`, `docs/TECHNICAL_ARCHITECTURE.md`, and `docs/BUILD_ORDER.md`.
