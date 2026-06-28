# Mobile app (`@dchill/mobile`)

Customer-facing **React Native (Expo)** app for DChill Outpost.

## Scope

Pickup-only MVP: browse catalog, scan barcodes, build a cart, pay via **Clover Hosted Checkout**, and track pickup orders. No delivery features.

## Phase 1B — Supabase client & auth foundation

- `src/lib/supabase.ts` — anon-key client (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`)
- `src/auth/index.ts` — `getCurrentSession`, `getCurrentUser`, `signInWithEmail`, `signOut`, `getUserProfile`, `getUserPermissions`

**Security:**

- Clients use the **anon key only** — never the service-role key.
- **Clover secrets** are server-only (Edge Functions).
- **RLS** is the real security layer; UI role/permission checks are convenience only.

Copy `apps/mobile/.env.example` → `.env` for local development.

## Status

Phase 1B foundation only — **no screens or product features yet.**

## Planned stack

- Expo (current stable SDK)
- React Navigation
- TanStack Query
- Supabase client (URL + anon key only)
- Barcode scanning via `expo-camera` `CameraView` (`onBarcodeScanned`)

## Next steps (not started)

1. Initialize Expo project shell in this directory.
2. Wire navigation and auth screens per `docs/BUILD_ORDER.md` Phase 3+.

See `docs/TECHNICAL_ARCHITECTURE.md` and `docs/FEATURE_REQUIREMENTS.md`.
