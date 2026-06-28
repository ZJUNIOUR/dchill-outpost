# DChill Outpost

Pickup-only Caribbean/international grocery app (Supabase + React Native/Expo +
React admin), with Clover for payments and a database-enforced, Owner-protected
RBAC system. See `docs/PROJECT_BRIEF.md`, `docs/TECHNICAL_ARCHITECTURE.md`, and `AGENTS.md`.

## Client configuration & secrets

- **Clients (mobile + admin)** may use only `SUPABASE_URL` and `SUPABASE_ANON_KEY` — public by design.
- **Service-role keys**, Clover app secrets, OAuth tokens, and Twilio auth tokens are **server-only** (Supabase Edge Functions / CI secrets). Never commit them or ship them in app bundles.
- **RLS is the security source of truth**; shared RBAC helpers in `@dchill/shared` are for UI gating only.
- Copy `.env.example` → `.env` locally; see `apps/mobile/.env.example`, `apps/admin/.env.example`, and `supabase/.env.example`.

## Security / RLS test suite

Row Level Security is the source of truth for app permissions, so a missing
policy or a weakened Owner/Technology-Specialist boundary is a **release
blocker**. Two SQL suites prove the posture and are wired into CI:

- `0002_rls_verification.sql` — RLS enabled on every table, no broad `anon`
  access, customers see only their own rows, `clover_credentials` returns zero
  rows for every app role, `payments.raw_event` is unreadable by app roles, and
  `audit_logs` is append-only.
- `test_technology_specialist_rbac.sql` — the Technology Specialist can run
  operational work but **cannot** affect, create, demote, delete, or escalate
  into `owner_admin`.

Both raise a SQL error on any failure, so the run exits non-zero and the build
fails.

### Run it locally before pushing

Prerequisites: a local **PostgreSQL 15+** and the `psql` client. The connecting
user needs superuser/CREATEDB rights (to create the test roles and a throwaway
database). The runner creates a disposable DB, applies everything, runs both
suites, and drops the DB — it never touches your real data.

```bash
# from the repo root
chmod +x scripts/run_security_tests.sh        # first time only

PGHOST=localhost PGPORT=5432 \
PGUSER=postgres PGPASSWORD=postgres \
./scripts/run_security_tests.sh
```

A green run ends with `ALL SECURITY TESTS PASSED`. Any failure prints a
PASS/FAIL table showing exactly which check broke.

The runner applies, in order:

1. `ci/supabase_test_shim.sql` — test-only shim providing the `anon`,
   `authenticated`, `service_role` roles and `auth.uid()` (Supabase supplies
   these in production; never apply the shim to a real project).
2. `DATABASE_SCHEMA.sql`
3. `0002_complete_rls_policies.sql`
4. `0002_rls_verification.sql`
5. `test_technology_specialist_rbac.sql`

### Run the SQL manually (optional)

Against any disposable database:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f ci/supabase_test_shim.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f DATABASE_SCHEMA.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0002_complete_rls_policies.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 0002_rls_verification.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f test_technology_specialist_rbac.sql
```

### CI

`.github/workflows/db-security.yml` runs the same suite on every push/PR that
touches the schema, the RLS migration, the tests, or the CI files (and via
manual dispatch). The job fails if any PASS/FAIL assertion fails, any sensitive
table lacks RLS, `clover_credentials` becomes readable by an app role, the
Technology Specialist can affect Owner/Admin, `audit_logs` becomes
updateable/deleteable, or `payments.raw_event` becomes readable by app roles.

> If you change any policy, run the suite locally first — and if you add a table,
> add its RLS + policies in the same migration and a matching assertion here. A
> table without policies is a bug (`AGENTS.md`).
