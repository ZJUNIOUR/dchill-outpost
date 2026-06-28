# Admin dashboard (`@dchill/admin`)

Staff-facing **React + Vite + TypeScript** web app for DChill Outpost.

## Scope

Operational dashboard: products, inventory, pricing, barcodes, pickup orders, customers, pickup rules, notifications, users/roles, reports, and settings. Access is gated by role + RLS — UI hiding alone is never sufficient.

## Secrets & environment

Copy `.env.example` → `.env`. Use only:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

**Never** add `SUPABASE_SERVICE_ROLE_KEY`, Clover secrets, or Twilio auth tokens to this app.
**RLS** is the real security layer; `@dchill/shared` role helpers hide UI only.

## Status

**Phase 0 scaffold only.** No Vite project, routes, or dependencies installed yet.

## Planned stack

- React + Vite + TypeScript
- TanStack Query + Supabase client (URL + anon key only)
- Realtime subscriptions for order queue and low-stock alerts

## Next steps (not started)

1. Initialize Vite + React + TS in this directory.
2. Wire workspace dependencies on `@dchill/types` and `@dchill/shared`.
3. Build admin shell with role-aware navigation per `docs/BUILD_ORDER.md` Phase 2+.

See `docs/USER_ROLES.md`, `docs/TECHNICAL_ARCHITECTURE.md`, and `docs/FEATURE_REQUIREMENTS.md`.
