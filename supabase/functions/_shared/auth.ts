import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

import { sanitizeClientError } from './json.ts';

const STAFF_ROLES = new Set([
  'staff',
  'order_staff',
  'inventory_staff',
  'manager',
  'admin',
  'technology_specialist',
  'owner_admin',
]);

const SYNC_PERMISSIONS = new Set([
  'products.write',
  'products.read',
  'inventory.write',
  'inventory.read',
  'settings.system',
  'settings.basic',
]);

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface SyncAuthContext {
  triggeredBy: 'cron' | 'manual';
  userId: string | null;
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing server environment variable: ${name}`);
  }
  return value;
}

/** Anon-key client scoped to the caller JWT (for auth.getUser only). */
export function createUserClient(jwt: string): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Validates sync invocation:
 * - `Authorization: Bearer <CLOVER_SYNC_CRON_SECRET>` for scheduled/server jobs, or
 * - staff JWT re-checked against `users` + `role_permissions` (never trust UI).
 */
export async function requireSyncAuth(
  req: Request,
  admin: SupabaseClient,
): Promise<SyncAuthContext> {
  const authHeader = req.headers.get('Authorization') ?? '';
  const cronSecret = Deno.env.get('CLOVER_SYNC_CRON_SECRET');

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { triggeredBy: 'cron', userId: null };
  }

  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt || jwt === cronSecret) {
    throw new AuthError('Unauthorized', 401);
  }

  const userClient = createUserClient(jwt);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    throw new AuthError('Unauthorized', 401);
  }

  const userId = userData.user.id;
  const { data: profile, error: profileError } = await admin
    .from('users')
    .select('role, is_active')
    .eq('id', userId)
    .maybeSingle();

  if (profileError || !profile) {
    throw new AuthError('Forbidden', 403);
  }

  if (!profile.is_active || !STAFF_ROLES.has(String(profile.role))) {
    throw new AuthError('Forbidden — staff role required', 403);
  }

  const { data: grants, error: grantsError } = await admin
    .from('role_permissions')
    .select('permission_key')
    .eq('role_key', profile.role);

  if (grantsError) {
    throw new AuthError('Authorization check failed', 403);
  }

  const hasSyncPermission = (grants ?? []).some((row) =>
    SYNC_PERMISSIONS.has(String(row.permission_key))
  );
  if (!hasSyncPermission) {
    throw new AuthError('Forbidden — missing inventory/catalog permission', 403);
  }

  return { triggeredBy: 'manual', userId };
}

export function toAuthErrorMessage(error: unknown): string {
  if (error instanceof AuthError) {
    return error.message;
  }
  if (error instanceof Error) {
    return sanitizeClientError(error.message);
  }
  return 'Authorization failed';
}

export function authErrorStatus(error: unknown): number {
  return error instanceof AuthError ? error.status : 500;
}
