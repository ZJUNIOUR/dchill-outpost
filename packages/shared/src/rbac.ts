import type { UserRole } from '@dchill/types';

import { ROLE_RANK, USER_ROLE } from './constants.js';

/** Store-facing operational roles at or above general staff (matches `is_staff_or_above()` in RLS migration). */
const STAFF_OR_ABOVE: ReadonlySet<UserRole> = new Set([
  USER_ROLE.STAFF,
  USER_ROLE.ORDER_STAFF,
  USER_ROLE.INVENTORY_STAFF,
  USER_ROLE.MANAGER,
  USER_ROLE.ADMIN,
  USER_ROLE.TECHNOLOGY_SPECIALIST,
  USER_ROLE.OWNER_ADMIN,
]);

/** Roles granted `users.manage_below_owner` in the seed catalog (UI hint only). */
const CAN_MANAGE_BELOW_OWNER: ReadonlySet<UserRole> = new Set([
  USER_ROLE.MANAGER,
  USER_ROLE.ADMIN,
  USER_ROLE.TECHNOLOGY_SPECIALIST,
  USER_ROLE.OWNER_ADMIN,
]);

export function isOwner(role: UserRole | null | undefined): boolean {
  return role === USER_ROLE.OWNER_ADMIN;
}

export function isTechnologySpecialist(role: UserRole | null | undefined): boolean {
  return role === USER_ROLE.TECHNOLOGY_SPECIALIST;
}

export function isStaffOrAbove(role: UserRole | null | undefined): boolean {
  return role !== null && role !== undefined && STAFF_OR_ABOVE.has(role);
}

export function canManageBelowOwner(role: UserRole | null | undefined): boolean {
  return role !== null && role !== undefined && CAN_MANAGE_BELOW_OWNER.has(role);
}

/**
 * Advisory rank from `roles.rank`. Returns `0` for unknown/null (fail closed for UI sorting).
 * Never use rank alone to authorize — RLS enforces access.
 */
export function roleRank(role: UserRole | null | undefined): number {
  if (role === null || role === undefined) {
    return 0;
  }
  return ROLE_RANK[role] ?? 0;
}
