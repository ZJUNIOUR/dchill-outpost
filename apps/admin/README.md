# Admin dashboard (`@dchill/admin`)

Staff-facing **React + Vite + TypeScript** web app for DChill Outpost.

## Scope

Operational dashboard: products, inventory, pricing, barcodes, pickup orders, customers, pickup rules, notifications, users/roles, reports, and settings. Access is gated by role + RLS — UI hiding alone is never sufficient.

## Status

**Phase 0 scaffold only.** No Vite project, routes, or dependencies installed yet.

## Planned stack

- React + Vite + TypeScript
- TanStack Query + Supabase client (URL + anon key only)
- Realtime subscriptions for order queue and low-stock alerts

## Secrets

Never import the Supabase service-role key, Clover credentials, or any backend secret into this package.

## Next steps (not started)

1. Initialize Vite + React + TS in this directory.
2. Wire workspace dependencies on `@dchill/types` and `@dchill/shared`.
3. Build admin shell with role-aware navigation per `docs/BUILD_ORDER.md` Phase 2+.

See `docs/USER_ROLES.md`, `docs/TECHNICAL_ARCHITECTURE.md`, and `docs/FEATURE_REQUIREMENTS.md`.
