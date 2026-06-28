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

/**
 * Mirrors `product_status` enum in DATABASE_SCHEMA.sql.
 */
export type ProductStatus =
  | 'in_stock'
  | 'low_stock'
  | 'out_of_stock'
  | 'hidden'
  | 'admin_only';

/**
 * `system_settings.clover_sync_mode` — legacy + canonical values (migration 0003).
 */
export type CloverSyncMode =
  | 'payments_only'
  | 'catalog_oneway'
  | 'full'
  | 'local_dev'
  | 'clover_readonly'
  | 'clover_primary';

/**
 * Clover mirror sync status on products, categories, and inventory rows.
 */
export type CloverSyncStatus =
  | 'local_only'
  | 'synced'
  | 'pending'
  | 'error'
  | 'conflict';

/** Maps legacy `clover_sync_mode` values to canonical modes (mirrors `effective_clover_sync_mode()`). */
export function effectiveCloverSyncMode(mode: CloverSyncMode): CloverSyncMode {
  if (mode === 'catalog_oneway') {
    return 'clover_readonly';
  }
  if (mode === 'full') {
    return 'clover_primary';
  }
  return mode;
}

/** Row shape from `public.clover_sync_runs` (staff read-only via RLS). */
export type CloverSyncRunType = 'catalog' | 'inventory' | 'webhook' | 'full';
export type CloverSyncRunStatus = 'running' | 'succeeded' | 'failed' | 'partial';

export interface CloverSyncRun {
  id: string;
  run_type: CloverSyncRunType;
  status: CloverSyncRunStatus;
  merchant_id: string | null;
  started_at: string;
  finished_at: string | null;
  records_upserted: number;
  records_failed: number;
  error_summary: string | null;
  triggered_by: string;
}

/** Row shape from `public.categories`. */
export interface Category {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  sort_order: number;
  is_active: boolean;
  clover_category_id: string | null;
  clover_sync_status: CloverSyncStatus;
  last_synced_at: string | null;
  clover_modified_at: string | null;
}

/** Row shape from `public.products` (prices as strings — matches numeric(10,2) without float drift). */
export interface Product {
  id: string;
  name: string;
  slug: string;
  category_id: string | null;
  brand: string | null;
  sku: string | null;
  description: string | null;
  size_unit: string | null;
  image_url: string | null;
  base_price: string;
  sale_price: string | null;
  is_taxable: boolean;
  is_featured: boolean;
  substitution_allowed: boolean;
  status: ProductStatus;
  clover_item_id: string | null;
  clover_sync_status: CloverSyncStatus;
  last_synced_at: string | null;
  clover_modified_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Row shape from `public.product_barcodes`. */
export interface ProductBarcode {
  id: string;
  product_id: string;
  barcode: string;
  is_primary: boolean;
  clover_alternate_code_id: string | null;
}

/** Product with nested barcode rows (admin joins). */
export interface ProductWithBarcodes extends ProductWithCategory {
  barcodes: ProductBarcode[];
}

/** Row shape from `public.inventory`. */
export interface InventoryRecord {
  product_id: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  low_stock_threshold: number;
  clover_sync_status: CloverSyncStatus;
  last_synced_at: string | null;
  updated_at: string;
}

/** Product list row with optional category name for admin tables. */
export interface ProductWithCategory extends Product {
  category: Pick<Category, 'id' | 'name' | 'slug'> | null;
}

/** Inventory row with product label for admin tables. */
export interface InventoryRecordWithProduct extends InventoryRecord {
  product: Pick<Product, 'id' | 'name' | 'sku' | 'status'> | null;
}

/**
 * Documented values for `inventory_logs.reason` (TEXT column — not a DB enum).
 * Schema comment: order_accepted | order_canceled | manual | restock
 */
export type InventoryLogReason =
  | 'order_accepted'
  | 'order_canceled'
  | 'manual'
  | 'restock';

/** Documented values for `inventory_logs.source` (migration 0003). */
export type InventoryLogSource =
  | 'app'
  | 'clover_sync'
  | 'edge_function'
  | 'order_flow';

/** Row shape from `public.inventory_logs`. */
export interface InventoryLog {
  id: string;
  product_id: string;
  change_qty: number;
  new_quantity: number;
  reason: string;
  user_id: string | null;
  order_id: string | null;
  source: InventoryLogSource;
  external_ref: string | null;
  created_at: string;
}

/** Inventory log with product label and actor (when RLS allows user join). */
export interface InventoryLogWithProduct extends InventoryLog {
  product: Pick<Product, 'id' | 'name' | 'sku'> | null;
  actor: Pick<UserProfile, 'id' | 'full_name' | 'email'> | null;
}
