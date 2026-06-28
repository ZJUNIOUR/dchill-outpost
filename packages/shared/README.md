# Shared package (`@dchill/shared`)

Cross-app **constants and pure helpers** for the mobile and admin clients.

## Phase 1A — included now

- `USER_ROLE` / `USER_ROLES` — mirrors `user_role` enum (`DATABASE_SCHEMA.sql`)
- `PERMISSION` / `PERMISSIONS` — mirrors `permissions` catalog (`docs/USER_ROLES.md`)
- `ROLE_RANK` — advisory ranks from seed data (UI only)
- RBAC helpers: `isOwner`, `isTechnologySpecialist`, `isStaffOrAbove`, `canManageBelowOwner`, `roleRank`

## Security (read this)

- **RLS in Postgres is the real security layer.** These helpers are for **UI gating and display only**.
- **Never** import `SUPABASE_SERVICE_ROLE_KEY`, Clover app secrets, OAuth tokens, or Twilio auth tokens here.
- Clients use only the public **Supabase URL** and **anon key** (see `.env.example` files).
- Clover checkout returns a **hosted URL** from an Edge Function — not a client-side secret.
- Pickup-only MVP — no delivery logic in this package.

## Usage

```ts
import { USER_ROLE, isOwner, isStaffOrAbove } from '@dchill/shared';
```

Depends on `@dchill/types`. Must not import Edge Function or server-only code.
