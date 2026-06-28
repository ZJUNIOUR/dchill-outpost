import { createClient } from '@supabase/supabase-js';

/**
 * Mobile Supabase client — public URL + anon key only.
 *
 * Security:
 * - Row Level Security (RLS) in Postgres is the real authority for every query.
 * - UI role/permission checks are convenience only; never sufficient alone.
 * - Service-role keys and Clover credentials are server-only (Edge Functions).
 */
function requirePublicEnv(name: 'EXPO_PUBLIC_SUPABASE_URL' | 'EXPO_PUBLIC_SUPABASE_ANON_KEY'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}. Copy apps/mobile/.env.example to .env and set public Supabase values.`);
  }
  return value;
}

export const supabase = createClient(
  requirePublicEnv('EXPO_PUBLIC_SUPABASE_URL'),
  requirePublicEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY'),
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);

export type MobileSupabaseClient = typeof supabase;
