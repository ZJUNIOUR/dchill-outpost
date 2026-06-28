/**
 * Vite public env (anon key only). RLS is the authoritative security layer —
 * this client never uses the service-role key or Clover secrets.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
