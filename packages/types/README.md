# Types package (`@dchill/types`)

Shared TypeScript types for DChill Outpost clients and packages.

## Status

**Phase 0 scaffold only.** Placeholder export; domain types will align with `DATABASE_SCHEMA.sql` in Phase 1+.

## Intended contents (future)

- Database row types and enums (`user_role`, `order_status`, etc.)
- API request/response shapes for Edge Functions (public surfaces only — no secrets)
- Permission keys matching `role_permissions`

## Usage (future)

```ts
import {} from '@dchill/types';
```

Keep in sync with schema migrations; never embed credentials or service-role types for client use.
