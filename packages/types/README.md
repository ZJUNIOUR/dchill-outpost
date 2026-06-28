# Types package (`@dchill/types`)

Shared TypeScript types aligned with `DATABASE_SCHEMA.sql` and `docs/USER_ROLES.md`.

## Phase 1A — included now

- `UserRole` — `user_role` enum (including `guest` and `developer` for full schema parity)
- `PermissionKey` — `permissions.key` catalog (including `catalog.browse` and `owner.protected`)
- `AuthUser`, `UserProfile`, `SessionState`, `RolePermissionState`, `AuthResult` — auth foundation types (Phase 1B)

## Security

Types describe data shapes only. **Authorization is enforced by RLS + triggers**, not by TypeScript.
Clients must not embed service-role keys or Clover secrets — see root `.env.example` and `AGENTS.md`.

## Usage

```ts
import type { UserRole, PermissionKey } from '@dchill/types';
```

Constants and helpers live in `@dchill/shared`.
