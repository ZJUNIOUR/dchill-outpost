import { createClient } from '@supabase/supabase-js';

/**
 * Admin Supabase client — public URL + anon key only.
 *
 * Security:
 * - Row Level Security (RLS) in Postgres is the real authority for every query.
 * - UI role/permission checks are convenience only; never sufficient alone.
 * - Service-role keys and Clover credentials are server-only (Edge Functions).
 */
function requireEnv(name: keyof ImportMetaEnv): string {
  const value = import.meta.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Copy apps/admin/.env.example to .env and set public Supabase values.`);
  }
  return value;
}

export const supabase = createClient(
  requireEnv('VITE_SUPABASE_URL'),
  requireEnv('VITE_SUPABASE_ANON_KEY'),
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

export type AdminSupabaseClient = typeof supabase;
