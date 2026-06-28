# Supabase (`supabase/`)

Backend layout for DChill Outpost: migrations, Edge Functions, seed data, and tests.

## Layout

| Path | Purpose |
|------|---------|
| `migrations/` | Forward-only SQL migrations (`NNNN_description.sql`) for the Supabase project |
| `functions/` | Deno Edge Functions (Clover checkout, webhooks, notifications, owner-checked credential changes) |
| `seed/` | Non-production seed scripts (never auto-create a second `owner_admin`) |
| `tests/` | Supabase-local or integration test helpers |

## Root SQL files (unchanged for now)

The security gate and CI still apply these **from the repo root**:

1. `ci/supabase_test_shim.sql`
2. `DATABASE_SCHEMA.sql`
3. `0002_complete_rls_policies.sql`
4. `0002_rls_verification.sql`
5. `test_technology_specialist_rbac.sql`

Run locally: `npm run test:security` (requires PostgreSQL 15+ and `psql`).

## Environment & secrets

Copy `.env.example` → `.env` for local Edge Function development.

- **Server-only:** `SUPABASE_SERVICE_ROLE_KEY`, Clover app secret, OAuth/merchant tokens, Twilio auth token — Supabase project secrets or CI only.
- **Never** expose service-role or Clover credentials to mobile/admin clients or Technology Specialist dashboards.
- Clients use public `SUPABASE_URL` + `SUPABASE_ANON_KEY`; **RLS** enforces who can do what.

When the Supabase CLI workflow is wired up, mirror or migrate root SQL into `migrations/` without breaking the existing runner until CI is updated.

## Rules

- RLS is the security source of truth; never disable RLS on sensitive tables.
- Service-role key and Clover credentials are **server-only** (Edge Function env / `clover_credentials`).
- Owner (`owner_admin`) protection must stay intact; keep `test_technology_specialist_rbac.sql` green.
- MVP is **pickup-only** — no delivery schema or features.

See `AGENTS.md`, `DATABASE_SCHEMA.sql`, and `docs/TECHNICAL_ARCHITECTURE.md`.
