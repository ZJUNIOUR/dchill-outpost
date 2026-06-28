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

## Secrets

Never import the Supabase service-role key, Clover credentials, or any backend secret into this package. Checkout receives only a hosted URL from an Edge Function.

## Next steps (not started)

1. Initialize Expo in this directory.
2. Wire workspace dependency on `@dchill/types` and `@dchill/shared`.
3. Add auth and catalog flows per `docs/BUILD_ORDER.md` Phase 3+.

See `docs/TECHNICAL_ARCHITECTURE.md` and `docs/FEATURE_REQUIREMENTS.md`.
