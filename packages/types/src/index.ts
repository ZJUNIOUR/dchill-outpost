/**
 * Mirrors `public.user_role` in DATABASE_SCHEMA.sql.
 * UI/logic only — RLS + triggers are the security source of truth.
 */
export type UserRole =
  | 'owner_admin'
  | 'technology_specialist'
  | 'admin'
  | 'manager'
  | 'inventory_staff'
  | 'order_staff'
  | 'staff'
  | 'customer'
  | 'guest'
  | 'developer';

/**
 * Keys in `public.permissions` / `role_permissions` (docs/USER_ROLES.md).
 */
export type PermissionKey =
  | 'catalog.browse'
  | 'products.read'
  | 'products.write'
  | 'inventory.read'
  | 'inventory.write'
  | 'prices.write'
  | 'barcodes.manage'
  | 'orders.read_own'
  | 'orders.read_all'
  | 'orders.update'
  | 'orders.cancel'
  | 'customers.manage'
  | 'pickup.rules_manage'
  | 'notifications.read'
  | 'notifications.resend'
  | 'reports.view'
  | 'settings.basic'
  | 'settings.system'
  | 'users.manage_below_owner'
  | 'roles.assign_below_owner'
  | 'maintenance.tools'
  | 'testing.tools'
  | 'db.troubleshoot_scoped'
  | 'owner.protected';

/** Minimal auth identity from Supabase Auth (JWT `sub` maps to `public.users.id`). */
export interface AuthUser {
  id: string;
  email: string | null;
  phone: string | null;
}

/** Row shape from `public.users` (role is canonical; never trust client-side claims alone). */
export interface UserProfile {
  id: string;
  email: string | null;
  phone: string | null;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  marketing_opt_in: boolean;
  created_at: string;
  updated_at: string;
}

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

/** Client-side session snapshot for UI state machines (RLS enforces access on every request). */
export interface SessionState {
  status: SessionStatus;
  accessToken: string | null;
  expiresAt: number | null;
  user: AuthUser | null;
  profile: UserProfile | null;
  error: string | null;
}

/** Permission catalog grants for the signed-in user's role (UI gating only). */
export interface RolePermissionState {
  role: UserRole | null;
  permissions: PermissionKey[];
  loading: boolean;
  error: string | null;
}

/** Result wrapper for auth helpers — fail closed on errors. */
export interface AuthResult<T> {
  data: T | null;
  error: string | null;
}
