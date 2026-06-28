# Admin dashboard (`@dchill/admin`)

Staff-facing **React + Vite + TypeScript** web app for DChill Outpost.

## Scope

Operational dashboard: products, inventory, pricing, barcodes, pickup orders, customers, pickup rules, notifications, users/roles, reports, and settings. Access is gated by role + RLS — UI hiding alone is never sufficient.

## Phase 1B — Supabase client & auth foundation

- `src/lib/supabase.ts` — anon-key client (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`)
- `src/auth/index.ts` — `getCurrentSession`, `getCurrentUser`, `signInWithEmail`, `signOut`, `getUserProfile`, `getUserPermissions`

**Security:**

- Clients use the **anon key only** — never the service-role key.
- **Clover secrets** are server-only (Edge Functions).
- **RLS** is the real security layer; `@dchill/shared` role helpers and permission lists are UI convenience only.

Copy `apps/admin/.env.example` → `.env` for local development.

## Status

Phase 1B foundation only — **no dashboard pages or operational features yet.**

## Planned stack

- React + Vite + TypeScript
- TanStack Query + Supabase client (URL + anon key only)
- Realtime subscriptions for order queue and low-stock alerts

## Next steps (not started)

1. Initialize Vite + React + TS project shell.
2. Build role-aware navigation per `docs/BUILD_ORDER.md` Phase 2+.

See `docs/USER_ROLES.md`, `docs/TECHNICAL_ARCHITECTURE.md`, and `docs/FEATURE_REQUIREMENTS.md`.
