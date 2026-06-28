/**
 * Expo public env (anon key only). RLS is the authoritative security layer —
 * this client never uses the service-role key or Clover secrets.
 */
declare namespace NodeJS {
  interface ProcessEnv {
    readonly EXPO_PUBLIC_SUPABASE_URL?: string;
    readonly EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
  }
}
