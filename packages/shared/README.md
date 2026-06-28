# Shared package (`@dchill/shared`)

Cross-app utilities shared by the mobile and admin clients.

## Status

**Phase 0 scaffold only.** Placeholder export; no business logic yet.

## Intended contents (future)

- Pure helpers (pricing display, date/time in `America/New_York`, cart totals)
- Supabase client factory wrappers (anon key only — no secrets)
- Permission/role display helpers (UI gating; RLS remains authoritative)

## Usage (future)

```ts
import {} from '@dchill/shared';
```

Depends on `@dchill/types`. Must not import server-only secrets or Edge Function code.
