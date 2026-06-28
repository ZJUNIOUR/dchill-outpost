import type { User } from '@supabase/supabase-js';
import type {
  AuthResult,
  AuthUser,
  PermissionKey,
  RolePermissionState,
  UserProfile,
  UserRole,
} from '@dchill/types';
import { PERMISSIONS } from '@dchill/shared';

import { supabase } from '../lib/supabase.js';

const PERMISSION_KEY_SET = new Set<string>(PERMISSIONS);

function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email ?? null,
    phone: user.phone ?? null,
  };
}

function parseUserRole(value: string): UserRole | null {
  switch (value) {
    case 'owner_admin':
    case 'technology_specialist':
    case 'admin':
    case 'manager':
    case 'inventory_staff':
    case 'order_staff':
    case 'staff':
    case 'customer':
    case 'guest':
    case 'developer':
      return value;
    default:
      return null;
  }
}

function parsePermissionKey(value: string): PermissionKey | null {
  return PERMISSION_KEY_SET.has(value) ? (value as PermissionKey) : null;
}

/** Returns the current Supabase Auth session (anon client; RLS applies to all data reads). */
export async function getCurrentSession(): Promise<AuthResult<{ accessToken: string; expiresAt: number | null }>> {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    return { data: null, error: error.message };
  }
  const session = data.session;
  if (!session) {
    return { data: null, error: null };
  }
  return {
    data: {
      accessToken: session.access_token,
      expiresAt: session.expires_at ?? null,
    },
    error: null,
  };
}

/** Returns the authenticated Supabase user, if any. */
export async function getCurrentUser(): Promise<AuthResult<AuthUser>> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    return { data: null, error: error.message };
  }
  if (!data.user) {
    return { data: null, error: null };
  }
  return { data: toAuthUser(data.user), error: null };
}

/** Email + password sign-in via Supabase Auth (role resolved from `public.users` on the server). */
export async function signInWithEmail(
  email: string,
  password: string,
): Promise<AuthResult<AuthUser>> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { data: null, error: error.message };
  }
  if (!data.user) {
    return { data: null, error: 'Sign-in succeeded but no user was returned.' };
  }
  return { data: toAuthUser(data.user), error: null };
}

/** Ends the current session. */
export async function signOut(): Promise<AuthResult<null>> {
  const { error } = await supabase.auth.signOut();
  if (error) {
    return { data: null, error: error.message };
  }
  return { data: null, error: null };
}

/**
 * Loads `public.users` for the signed-in user. RLS restricts to own row (or elevated policies).
 * Never bypasses RLS — uses the anon-key client only.
 */
export async function getUserProfile(): Promise<AuthResult<UserProfile>> {
  const userResult = await getCurrentUser();
  if (userResult.error) {
    return { data: null, error: userResult.error };
  }
  if (!userResult.data) {
    return { data: null, error: null };
  }

  const { data, error } = await supabase
    .from('users')
    .select(
      'id, email, phone, full_name, role, is_active, marketing_opt_in, created_at, updated_at',
    )
    .eq('id', userResult.data.id)
    .maybeSingle();

  if (error) {
    return { data: null, error: error.message };
  }
  if (!data) {
    return { data: null, error: null };
  }

  const role = parseUserRole(String(data.role));
  if (!role) {
    return { data: null, error: 'Profile has an unrecognized role.' };
  }

  return {
    data: {
      id: data.id,
      email: data.email,
      phone: data.phone,
      full_name: data.full_name,
      role,
      is_active: data.is_active,
      marketing_opt_in: data.marketing_opt_in,
      created_at: data.created_at,
      updated_at: data.updated_at,
    },
    error: null,
  };
}

/**
 * Loads permission keys for the signed-in user's role from `role_permissions`.
 * UI gating only — every sensitive action is enforced independently by RLS.
 */
export async function getUserPermissions(): Promise<RolePermissionState> {
  const profileResult = await getUserProfile();
  if (profileResult.error) {
    return { role: null, permissions: [], loading: false, error: profileResult.error };
  }
  if (!profileResult.data) {
    return { role: null, permissions: [], loading: false, error: null };
  }

  const { data, error } = await supabase
    .from('role_permissions')
    .select('permission_key')
    .eq('role_key', profileResult.data.role);

  if (error) {
    return { role: profileResult.data.role, permissions: [], loading: false, error: error.message };
  }

  const permissions = (data ?? [])
    .map((row: { permission_key: string }) => parsePermissionKey(String(row.permission_key)))
    .filter((key: PermissionKey | null): key is PermissionKey => key !== null);

  return {
    role: profileResult.data.role,
    permissions,
    loading: false,
    error: null,
  };
}
