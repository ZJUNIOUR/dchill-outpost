# Mobile app (`@dchill/mobile`)

Customer-facing **React Native (Expo)** app for DChill Outpost.

## Scope

Pickup-only MVP: browse catalog, scan barcodes, build a cart, pay via **Clover Hosted Checkout**, and track pickup orders. No delivery features.

## Status

**Phase 0 scaffold only.** No Expo project, screens, or dependencies installed yet.

## Planned stack

- Expo (current stable SDK)
- React Navigation
- TanStack Query
- Supabase client (URL + anon key only — no service-role key)
- Barcode scanning via `expo-camera` `CameraView` (`onBarcodeScanned`)

## Secrets & environment

Copy `.env.example` → `.env`. Use only:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

**Never** add `SUPABASE_SERVICE_ROLE_KEY`, Clover client secrets, or access tokens to this app.
Checkout uses a **Clover Hosted Checkout URL** from an Edge Function. **RLS** enforces data access — UI role checks are courtesy only.

## Next steps (not started)

1. Initialize Expo in this directory.
2. Wire workspace dependency on `@dchill/types` and `@dchill/shared`.
3. Add auth and catalog flows per `docs/BUILD_ORDER.md` Phase 3+.

See `docs/TECHNICAL_ARCHITECTURE.md` and `docs/FEATURE_REQUIREMENTS.md`.
