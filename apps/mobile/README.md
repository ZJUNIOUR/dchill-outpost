# Mobile app (`@dchill/mobile`)

Customer-facing **React Native (Expo)** app for DChill Outpost.

## Scope

Pickup-only MVP: browse catalog, scan barcodes, build a cart, pay via **Clover Hosted Checkout**, and track pickup orders. No delivery features.

## Phase 1D — Auth-wired shell

Minimal Expo app with email/password sign-in and a placeholder home screen. No catalog, cart, barcode, order, or notification features yet.

**Key files:**

- `index.ts` — Expo entry (registers `src/App.tsx`)
- `src/App.tsx` — auth gate (login vs home)
- `src/auth/AuthProvider.tsx`, `src/auth/useAuth.ts` — session context
- `src/auth/index.ts` — Supabase auth helpers
- `src/lib/supabase.ts` — anon-key client
- `src/screens/LoginScreen.tsx`, `src/screens/HomePlaceholderScreen.tsx`

**Security:**

- Clients use the **anon key only** — never the service-role key.
- **Clover secrets** are server-only (Edge Functions).
- **RLS** is the real security layer; UI role display is convenience only.

## Environment variables

Copy `apps/mobile/.env.example` → `apps/mobile/.env` and set:

| Variable | Required | Description |
|----------|----------|-------------|
| `EXPO_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon (public) key |

Expo inlines `EXPO_PUBLIC_*` at build time. Do not put the service-role key or Clover secrets in this file.

## Run locally

From the repository root (after `npm install` at root):

```bash
npm run start -w @dchill/mobile
```

Or from `apps/mobile`:

```bash
npm run start
```

Then open the app in Expo Go, an emulator, or a dev build.

```bash
npm run typecheck -w @dchill/mobile
```

## Status

Phase 1D shell only — **no catalog, cart, barcode, orders, or payments UI yet.**

See `docs/TECHNICAL_ARCHITECTURE.md` and `docs/BUILD_ORDER.md`.
