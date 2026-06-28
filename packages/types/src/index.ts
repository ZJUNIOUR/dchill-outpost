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
