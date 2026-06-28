import type { PermissionKey, UserRole } from '@dchill/types';

/** Enum string literals — must stay aligned with `user_role` in DATABASE_SCHEMA.sql. */
export const USER_ROLE = {
  OWNER_ADMIN: 'owner_admin',
  TECHNOLOGY_SPECIALIST: 'technology_specialist',
  ADMIN: 'admin',
  MANAGER: 'manager',
  INVENTORY_STAFF: 'inventory_staff',
  ORDER_STAFF: 'order_staff',
  STAFF: 'staff',
  CUSTOMER: 'customer',
  GUEST: 'guest',
  DEVELOPER: 'developer',
} as const satisfies Record<string, UserRole>;

/** All `user_role` values in enum declaration order (DATABASE_SCHEMA.sql). */
export const USER_ROLES: readonly UserRole[] = [
  USER_ROLE.GUEST,
  USER_ROLE.CUSTOMER,
  USER_ROLE.STAFF,
  USER_ROLE.ORDER_STAFF,
  USER_ROLE.INVENTORY_STAFF,
  USER_ROLE.MANAGER,
  USER_ROLE.ADMIN,
  USER_ROLE.TECHNOLOGY_SPECIALIST,
  USER_ROLE.OWNER_ADMIN,
  USER_ROLE.DEVELOPER,
];

/**
 * Advisory ranks from `roles.rank` seed (docs/USER_ROLES.md).
 * Authorization never relies on ordinal enum position — use explicit checks + RLS.
 */
export const ROLE_RANK: Readonly<Record<UserRole, number>> = {
  [USER_ROLE.OWNER_ADMIN]: 100,
  [USER_ROLE.TECHNOLOGY_SPECIALIST]: 90,
  [USER_ROLE.ADMIN]: 80,
  [USER_ROLE.MANAGER]: 70,
  [USER_ROLE.INVENTORY_STAFF]: 50,
  [USER_ROLE.ORDER_STAFF]: 50,
  [USER_ROLE.STAFF]: 40,
  [USER_ROLE.CUSTOMER]: 10,
  [USER_ROLE.GUEST]: 0,
  [USER_ROLE.DEVELOPER]: -1,
};

/** Permission keys from docs/USER_ROLES.md / `permissions` catalog. */
export const PERMISSION = {
  CATALOG_BROWSE: 'catalog.browse',
  PRODUCTS_READ: 'products.read',
  PRODUCTS_WRITE: 'products.write',
  INVENTORY_READ: 'inventory.read',
  INVENTORY_WRITE: 'inventory.write',
  PRICES_WRITE: 'prices.write',
  BARCODES_MANAGE: 'barcodes.manage',
  ORDERS_READ_OWN: 'orders.read_own',
  ORDERS_READ_ALL: 'orders.read_all',
  ORDERS_UPDATE: 'orders.update',
  ORDERS_CANCEL: 'orders.cancel',
  CUSTOMERS_MANAGE: 'customers.manage',
  PICKUP_RULES_MANAGE: 'pickup.rules_manage',
  NOTIFICATIONS_READ: 'notifications.read',
  NOTIFICATIONS_RESEND: 'notifications.resend',
  REPORTS_VIEW: 'reports.view',
  SETTINGS_BASIC: 'settings.basic',
  SETTINGS_SYSTEM: 'settings.system',
  USERS_MANAGE_BELOW_OWNER: 'users.manage_below_owner',
  ROLES_ASSIGN_BELOW_OWNER: 'roles.assign_below_owner',
  MAINTENANCE_TOOLS: 'maintenance.tools',
  TESTING_TOOLS: 'testing.tools',
  DB_TROUBLESHOOT_SCOPED: 'db.troubleshoot_scoped',
  OWNER_PROTECTED: 'owner.protected',
} as const satisfies Record<string, PermissionKey>;

export const PERMISSIONS: readonly PermissionKey[] = Object.values(PERMISSION);
