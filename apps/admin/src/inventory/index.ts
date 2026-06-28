import type {
  AuthResult,
  Category,
  CloverSyncMode,
  CloverSyncStatus,
  InventoryLog,
  InventoryLogReason,
  InventoryLogSource,
  InventoryLogWithProduct,
  InventoryRecord,
  InventoryRecordWithProduct,
  Product,
  ProductBarcode,
  ProductStatus,
  ProductWithCategory,
} from '@dchill/types';
import type { PostgrestError } from '@supabase/supabase-js';

import { getCurrentUser } from '../auth/index.js';
import { supabase } from '../lib/supabase.js';

/**
 * Admin inventory helpers — anon Supabase client only (RLS enforced).
 *
 * WRITE helpers in this module are temporary local-dev/admin foundation (Phase 2A–2C).
 * Production catalog/stock mutations must go through Clover Edge Functions
 * (Clover first, then Supabase mirror) — see docs/MEMORY.md §6a.
 */

const PRODUCT_STATUSES: ReadonlySet<string> = new Set([
  'in_stock',
  'low_stock',
  'out_of_stock',
  'hidden',
  'admin_only',
]);

const CLOVER_SYNC_STATUSES: ReadonlySet<string> = new Set([
  'local_only',
  'synced',
  'pending',
  'error',
  'conflict',
]);

const CLOVER_SYNC_MODES: ReadonlySet<string> = new Set([
  'payments_only',
  'catalog_oneway',
  'full',
  'local_dev',
  'clover_readonly',
  'clover_primary',
]);

const INVENTORY_LOG_SOURCES: ReadonlySet<string> = new Set([
  'app',
  'clover_sync',
  'edge_function',
  'order_flow',
]);

const PRODUCT_SELECT =
  'id, name, slug, category_id, brand, sku, description, size_unit, image_url, base_price, sale_price, is_taxable, is_featured, substitution_allowed, status, clover_item_id, clover_sync_status, last_synced_at, clover_modified_at, created_at, updated_at';

const CATEGORY_SELECT =
  'id, name, slug, parent_id, sort_order, is_active, clover_category_id, clover_sync_status, last_synced_at, clover_modified_at';

const PRODUCT_BARCODE_SELECT =
  'id, product_id, barcode, is_primary, clover_alternate_code_id';

const INVENTORY_LOG_ROW_SELECT =
  'id, product_id, change_qty, new_quantity, reason, user_id, order_id, source, external_ref, created_at';

const PRODUCT_WITH_CATEGORY_SELECT = `${PRODUCT_SELECT}, categories ( id, name, slug )`;

/** Documented manual-adjustment reasons (maps to `inventory_logs.reason` TEXT). */
export const INVENTORY_LOG_REASONS: readonly InventoryLogReason[] = [
  'manual',
  'restock',
  'order_accepted',
  'order_canceled',
] as const;

/**
 * Stock update + log insert from the admin client are separate HTTP requests — not atomic.
 * Order flows and production adjustments should use a SECURITY DEFINER RPC or Edge Function later.
 */
export const INVENTORY_ADJUSTMENT_NON_ATOMIC =
  'Inventory was updated in a separate request from the log row. Atomic stock adjustments require a future database RPC or Edge Function.';

function formatDbError(error: PostgrestError): string {
  if (error.code === '42501' || error.message.toLowerCase().includes('row-level security')) {
    return 'Permission denied — RLS blocked this action. Your role may not have the required permission.';
  }
  return error.message;
}

function parseCloverSyncStatus(value: unknown): CloverSyncStatus {
  const raw = String(value ?? 'local_only');
  return CLOVER_SYNC_STATUSES.has(raw) ? (raw as CloverSyncStatus) : 'local_only';
}

function parseCloverSyncMode(value: unknown): CloverSyncMode {
  const raw = String(value ?? 'payments_only');
  return CLOVER_SYNC_MODES.has(raw) ? (raw as CloverSyncMode) : 'payments_only';
}

function parseInventoryLogSource(value: unknown): InventoryLogSource {
  const raw = String(value ?? 'app');
  return INVENTORY_LOG_SOURCES.has(raw) ? (raw as InventoryLogSource) : 'app';
}

function parseProductStatus(value: string): ProductStatus | null {
  return PRODUCT_STATUSES.has(value) ? (value as ProductStatus) : null;
}

function toPriceString(value: unknown): string {
  if (value === null || value === undefined) {
    return '0.00';
  }
  return String(value);
}

function mapProduct(row: Record<string, unknown>): Product | null {
  const status = parseProductStatus(String(row.status));
  if (!status) {
    return null;
  }

  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    category_id: row.category_id ? String(row.category_id) : null,
    brand: row.brand ? String(row.brand) : null,
    sku: row.sku ? String(row.sku) : null,
    description: row.description ? String(row.description) : null,
    size_unit: row.size_unit ? String(row.size_unit) : null,
    image_url: row.image_url ? String(row.image_url) : null,
    base_price: toPriceString(row.base_price),
    sale_price: row.sale_price === null || row.sale_price === undefined ? null : toPriceString(row.sale_price),
    is_taxable: Boolean(row.is_taxable),
    is_featured: Boolean(row.is_featured),
    substitution_allowed: Boolean(row.substitution_allowed),
    status,
    clover_item_id: row.clover_item_id ? String(row.clover_item_id) : null,
    clover_sync_status: parseCloverSyncStatus(row.clover_sync_status),
    last_synced_at: row.last_synced_at ? String(row.last_synced_at) : null,
    clover_modified_at: row.clover_modified_at ? String(row.clover_modified_at) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function mapCategory(row: Record<string, unknown>): Category {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    parent_id: row.parent_id ? String(row.parent_id) : null,
    sort_order: Number(row.sort_order),
    is_active: Boolean(row.is_active),
    clover_category_id: row.clover_category_id ? String(row.clover_category_id) : null,
    clover_sync_status: parseCloverSyncStatus(row.clover_sync_status),
    last_synced_at: row.last_synced_at ? String(row.last_synced_at) : null,
    clover_modified_at: row.clover_modified_at ? String(row.clover_modified_at) : null,
  };
}

function mapInventory(row: Record<string, unknown>): InventoryRecord {
  return {
    product_id: String(row.product_id),
    quantity_on_hand: Number(row.quantity_on_hand),
    quantity_reserved: Number(row.quantity_reserved),
    low_stock_threshold: Number(row.low_stock_threshold),
    clover_sync_status: parseCloverSyncStatus(row.clover_sync_status),
    last_synced_at: row.last_synced_at ? String(row.last_synced_at) : null,
    updated_at: String(row.updated_at),
  };
}

function mapProductBarcode(row: Record<string, unknown>): ProductBarcode {
  return {
    id: String(row.id),
    product_id: String(row.product_id),
    barcode: String(row.barcode),
    is_primary: Boolean(row.is_primary),
    clover_alternate_code_id: row.clover_alternate_code_id
      ? String(row.clover_alternate_code_id)
      : null,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function mapInventoryLog(row: Record<string, unknown>): InventoryLog {
  return {
    id: String(row.id),
    product_id: String(row.product_id),
    change_qty: Number(row.change_qty),
    new_quantity: Number(row.new_quantity),
    reason: String(row.reason),
    user_id: row.user_id ? String(row.user_id) : null,
    order_id: row.order_id ? String(row.order_id) : null,
    source: parseInventoryLogSource(row.source),
    external_ref: row.external_ref ? String(row.external_ref) : null,
    created_at: String(row.created_at),
  };
}

function mapInventoryLogWithProduct(row: Record<string, unknown>): InventoryLogWithProduct {
  const log = mapInventoryLog(row);

  const productRaw = row.products as Record<string, unknown> | Record<string, unknown>[] | null;
  const productRow = Array.isArray(productRaw) ? productRaw[0] : productRaw;

  const userRaw = row.users as Record<string, unknown> | Record<string, unknown>[] | null;
  const userRow = Array.isArray(userRaw) ? userRaw[0] : userRaw;

  return {
    ...log,
    product: productRow
      ? {
          id: String(productRow.id),
          name: String(productRow.name),
          sku: productRow.sku ? String(productRow.sku) : null,
        }
      : null,
    actor: userRow
      ? {
          id: String(userRow.id),
          full_name: String(userRow.full_name),
          email: userRow.email ? String(userRow.email) : null,
        }
      : null,
  };
}

function formatLogReason(reason: InventoryLogReason, note?: string): string {
  const trimmed = note?.trim();
  if (!trimmed) {
    return reason;
  }
  return `${reason}: ${trimmed}`;
}

const INVENTORY_LOG_SELECT =
  'id, product_id, change_qty, new_quantity, reason, user_id, order_id, source, external_ref, created_at, products ( id, name, sku ), users ( id, full_name, email )';

function mapProductWithCategory(row: Record<string, unknown>): ProductWithCategory | null {
  const product = mapProduct(row);
  if (!product) {
    return null;
  }

  const categoryRaw = row.categories as Record<string, unknown> | Record<string, unknown>[] | null;
  const categoryRow = Array.isArray(categoryRaw) ? categoryRaw[0] : categoryRaw;

  return {
    ...product,
    category: categoryRow
      ? {
          id: String(categoryRow.id),
          name: String(categoryRow.name),
          slug: String(categoryRow.slug),
        }
      : null,
  };
}

export interface CreateProductInput {
  name: string;
  slug: string;
  category_id?: string | null;
  brand?: string | null;
  sku?: string | null;
  description?: string | null;
  size_unit?: string | null;
  base_price: string;
  sale_price?: string | null;
  status?: ProductStatus;
}

export interface UpdateProductInput {
  name?: string;
  slug?: string;
  category_id?: string | null;
  brand?: string | null;
  sku?: string | null;
  description?: string | null;
  size_unit?: string | null;
  base_price?: string;
  sale_price?: string | null;
  status?: ProductStatus;
}

/** Lists products with category name. RLS enforces read access. */
export async function listProducts(): Promise<AuthResult<ProductWithCategory[]>> {
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_WITH_CATEGORY_SELECT)
    .order('name', { ascending: true });

  if (error) {
    return { data: null, error: formatDbError(error) };
  }

  const products = (data ?? [])
    .map((row) => mapProductWithCategory(row as Record<string, unknown>))
    .filter((row): row is ProductWithCategory => row !== null);

  return { data: products, error: null };
}

/** Lists active categories for product forms. RLS enforces read access. */
export async function listCategories(): Promise<AuthResult<Category[]>> {
  const { data, error } = await supabase
    .from('categories')
    .select(CATEGORY_SELECT)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    return { data: null, error: formatDbError(error) };
  }

  return {
    data: (data ?? []).map((row) => mapCategory(row as Record<string, unknown>)),
    error: null,
  };
}

/** Loads one product by id. RLS enforces read access. */
export async function getProductById(productId: string): Promise<AuthResult<ProductWithCategory>> {
  const { data, error } = await supabase
    .from('products')
    .select(PRODUCT_WITH_CATEGORY_SELECT)
    .eq('id', productId)
    .maybeSingle();

  if (error) {
    return { data: null, error: formatDbError(error) };
  }
  if (!data) {
    return { data: null, error: 'Product not found.' };
  }

  const product = mapProductWithCategory(data as Record<string, unknown>);
  if (!product) {
    return { data: null, error: 'Product has an invalid status value.' };
  }

  return { data: product, error: null };
}

/** Creates a product. Requires `products.write` (enforced by RLS). */
export async function createProduct(input: CreateProductInput): Promise<AuthResult<Product>> {
  const { data, error } = await supabase
    .from('products')
    .insert({
      name: input.name,
      slug: input.slug,
      category_id: input.category_id ?? null,
      brand: input.brand ?? null,
      sku: input.sku ?? null,
      description: input.description ?? null,
      size_unit: input.size_unit ?? null,
      base_price: input.base_price,
      sale_price: input.sale_price ?? null,
      status: input.status ?? 'in_stock',
    })
    .select(PRODUCT_SELECT)
    .single();

  if (error) {
    return { data: null, error: formatDbError(error) };
  }

  const product = mapProduct(data as Record<string, unknown>);
  if (!product) {
    return { data: null, error: 'Created product has an invalid status value.' };
  }

  return { data: product, error: null };
}

/** Updates product fields. Requires `products.write` (enforced by RLS). */
export async function updateProduct(
  productId: string,
  input: UpdateProductInput,
): Promise<AuthResult<Product>> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.category_id !== undefined) patch.category_id = input.category_id;
  if (input.brand !== undefined) patch.brand = input.brand;
  if (input.sku !== undefined) patch.sku = input.sku;
  if (input.description !== undefined) patch.description = input.description;
  if (input.size_unit !== undefined) patch.size_unit = input.size_unit;
  if (input.base_price !== undefined) patch.base_price = input.base_price;
  if (input.sale_price !== undefined) patch.sale_price = input.sale_price;
  if (input.status !== undefined) patch.status = input.status;

  const { data, error } = await supabase
    .from('products')
    .update(patch)
    .eq('id', productId)
    .select(PRODUCT_SELECT)
    .single();

  if (error) {
    return { data: null, error: formatDbError(error) };
  }

  const product = mapProduct(data as Record<string, unknown>);
  if (!product) {
    return { data: null, error: 'Updated product has an invalid status value.' };
  }

  return { data: product, error: null };
}

/**
 * Toggles customer visibility via `status` (hidden = inactive, in_stock = active baseline).
 * Requires `products.write` (enforced by RLS).
 */
export async function setProductActive(
  productId: string,
  active: boolean,
): Promise<AuthResult<Product>> {
  const status: ProductStatus = active ? 'in_stock' : 'hidden';
  return updateProduct(productId, { status });
}

/** Lists raw inventory counts (staff-only via RLS). */
export async function listInventoryRecords(): Promise<AuthResult<InventoryRecordWithProduct[]>> {
  const { data, error } = await supabase
    .from('inventory')
    .select(
      'product_id, quantity_on_hand, quantity_reserved, low_stock_threshold, clover_sync_status, last_synced_at, updated_at, products ( id, name, sku, status )',
    )
    .order('updated_at', { ascending: false });

  if (error) {
    return { data: null, error: formatDbError(error) };
  }

  const records: InventoryRecordWithProduct[] = (data ?? []).map((row) => {
    const inventory = mapInventory(row as Record<string, unknown>);
    const productRaw = row.products as Record<string, unknown> | Record<string, unknown>[] | null;
    const productRow = Array.isArray(productRaw) ? productRaw[0] : productRaw;

    return {
      ...inventory,
      product: productRow
        ? {
            id: String(productRow.id),
            name: String(productRow.name),
            sku: productRow.sku ? String(productRow.sku) : null,
            status: parseProductStatus(String(productRow.status)) ?? 'in_stock',
          }
        : null,
    };
  });

  return { data: records, error: null };
}

/** Sets on-hand quantity (upsert). Requires `inventory.write` (enforced by RLS). */
export async function updateInventoryQuantity(
  productId: string,
  quantityOnHand: number,
): Promise<AuthResult<InventoryRecord>> {
  if (!Number.isInteger(quantityOnHand) || quantityOnHand < 0) {
    return { data: null, error: 'Quantity must be a non-negative whole number.' };
  }

  const { data, error } = await supabase
    .from('inventory')
    .upsert(
      {
        product_id: productId,
        quantity_on_hand: quantityOnHand,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'product_id' },
    )
    .select(
      'product_id, quantity_on_hand, quantity_reserved, low_stock_threshold, clover_sync_status, last_synced_at, updated_at',
    )
    .single();

  if (error) {
    return { data: null, error: formatDbError(error) };
  }

  return { data: mapInventory(data as Record<string, unknown>), error: null };
}

/** Lists recent inventory log rows (staff-only via RLS). */
export async function listInventoryLogs(limit = 100): Promise<AuthResult<InventoryLogWithProduct[]>> {
  const { data, error } = await supabase
    .from('inventory_logs')
    .select(INVENTORY_LOG_SELECT)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return { data: null, error: formatDbError(error) };
  }

  return {
    data: (data ?? []).map((row) => mapInventoryLogWithProduct(row as Record<string, unknown>)),
    error: null,
  };
}

/** Lists inventory log rows for one product (staff-only via RLS). */
export async function listInventoryLogsForProduct(
  productId: string,
  limit = 100,
): Promise<AuthResult<InventoryLogWithProduct[]>> {
  const { data, error } = await supabase
    .from('inventory_logs')
    .select(INVENTORY_LOG_SELECT)
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return { data: null, error: formatDbError(error) };
  }

  return {
    data: (data ?? []).map((row) => mapInventoryLogWithProduct(row as Record<string, unknown>)),
    error: null,
  };
}

export interface CreateInventoryLogInput {
  product_id: string;
  change_qty: number;
  new_quantity: number;
  reason: string;
  order_id?: string | null;
  user_id?: string | null;
}

/**
 * Inserts one `inventory_logs` row. Requires `inventory.write` (RLS `inv_logs_insert`).
 * Append-only — no update/delete policies on this table.
 */
export async function createInventoryLog(
  input: CreateInventoryLogInput,
): Promise<AuthResult<InventoryLog>> {
  let userId = input.user_id ?? null;
  if (userId === null) {
    const userResult = await getCurrentUser();
    if (userResult.error) {
      return { data: null, error: userResult.error };
    }
    userId = userResult.data?.id ?? null;
  }

  const { data, error } = await supabase
    .from('inventory_logs')
    .insert({
      product_id: input.product_id,
      change_qty: input.change_qty,
      new_quantity: input.new_quantity,
      reason: input.reason,
      user_id: userId,
      order_id: input.order_id ?? null,
    })
    .select(INVENTORY_LOG_ROW_SELECT)
    .single();

  if (error) {
    return { data: null, error: formatDbError(error) };
  }

  return { data: mapInventoryLog(data as Record<string, unknown>), error: null };
}

export interface AdjustInventoryWithLogInput {
  productId: string;
  newQuantityOnHand: number;
  reason: InventoryLogReason;
  note?: string;
}

export interface AdjustInventoryWithLogResult {
  inventory: InventoryRecord;
  log: InventoryLog | null;
  /** Set when inventory updated but log insert failed (non-atomic client limitation). */
  partialFailure: boolean;
}

/**
 * Updates on-hand quantity then inserts a log row — two separate requests (not atomic).
 * Requires `inventory.write` for both steps. See `INVENTORY_ADJUSTMENT_NON_ATOMIC`.
 */
export async function adjustInventoryQuantityWithLog(
  input: AdjustInventoryWithLogInput,
): Promise<AuthResult<AdjustInventoryWithLogResult>> {
  if (!Number.isInteger(input.newQuantityOnHand) || input.newQuantityOnHand < 0) {
    return { data: null, error: 'Quantity must be a non-negative whole number.' };
  }

  const { data: currentRow, error: readError } = await supabase
    .from('inventory')
    .select('quantity_on_hand')
    .eq('product_id', input.productId)
    .maybeSingle();

  if (readError) {
    return { data: null, error: formatDbError(readError) };
  }

  const previousQty = currentRow ? Number(currentRow.quantity_on_hand) : 0;
  const changeQty = input.newQuantityOnHand - previousQty;

  const updateResult = await updateInventoryQuantity(input.productId, input.newQuantityOnHand);
  if (updateResult.error || !updateResult.data) {
    return { data: null, error: updateResult.error ?? 'Inventory update failed.' };
  }

  const logResult = await createInventoryLog({
    product_id: input.productId,
    change_qty: changeQty,
    new_quantity: input.newQuantityOnHand,
    reason: formatLogReason(input.reason, input.note),
  });

  if (logResult.error || !logResult.data) {
    return {
      data: {
        inventory: updateResult.data,
        log: null,
        partialFailure: true,
      },
      error: `Inventory updated to ${input.newQuantityOnHand}, but log insert failed: ${logResult.error ?? 'unknown error'}. ${INVENTORY_ADJUSTMENT_NON_ATOMIC}`,
    };
  }

  return {
    data: {
      inventory: updateResult.data,
      log: logResult.data,
      partialFailure: false,
    },
    error: null,
  };
}

export interface CreateCategoryInput {
  name: string;
  slug: string;
  parent_id?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface UpdateCategoryInput {
  name?: string;
  slug?: string;
  parent_id?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

/** Creates a category. Requires `products.write` (enforced by RLS on categories). */
export async function createCategory(input: CreateCategoryInput): Promise<AuthResult<Category>> {
  const { data, error } = await supabase
    .from('categories')
    .insert({
      name: input.name,
      slug: input.slug,
      parent_id: input.parent_id ?? null,
      sort_order: input.sort_order ?? 0,
      is_active: input.is_active ?? true,
    })
    .select(CATEGORY_SELECT)
    .single();

  if (error) {
    return { data: null, error: formatDbError(error) };
  }

  return { data: mapCategory(data as Record<string, unknown>), error: null };
}

/** Updates category fields. Requires `products.write` (enforced by RLS). */
export async function updateCategory(
  categoryId: string,
  input: UpdateCategoryInput,
): Promise<AuthResult<Category>> {
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.parent_id !== undefined) patch.parent_id = input.parent_id;
  if (input.sort_order !== undefined) patch.sort_order = input.sort_order;
  if (input.is_active !== undefined) patch.is_active = input.is_active;

  const { data, error } = await supabase
    .from('categories')
    .update(patch)
    .eq('id', categoryId)
    .select(CATEGORY_SELECT)
    .single();

  if (error) {
    return { data: null, error: formatDbError(error) };
  }

  return { data: mapCategory(data as Record<string, unknown>), error: null };
}

/** Toggles `is_active` on a category. Requires `products.write` (enforced by RLS). */
export async function setCategoryActive(
  categoryId: string,
  active: boolean,
): Promise<AuthResult<Category>> {
  return updateCategory(categoryId, { is_active: active });
}

/** Lists barcodes for one product. RLS enforces read access. */
export async function listProductBarcodes(productId: string): Promise<AuthResult<ProductBarcode[]>> {
  const { data, error } = await supabase
    .from('product_barcodes')
    .select(PRODUCT_BARCODE_SELECT)
    .eq('product_id', productId)
    .order('is_primary', { ascending: false })
    .order('barcode', { ascending: true });

  if (error) {
    return { data: null, error: formatDbError(error) };
  }

  return {
    data: (data ?? []).map((row) => mapProductBarcode(row as Record<string, unknown>)),
    error: null,
  };
}

/**
 * Adds a barcode to a product. Schema has no `barcode_type` column — only `barcode` and `is_primary`.
 * Requires `barcodes.manage` (enforced by RLS).
 */
export async function addProductBarcode(
  productId: string,
  barcode: string,
  isPrimary = false,
): Promise<AuthResult<ProductBarcode>> {
  const trimmed = barcode.trim();
  if (!trimmed) {
    return { data: null, error: 'Barcode is required.' };
  }

  const { data, error } = await supabase
    .from('product_barcodes')
    .insert({
      product_id: productId,
      barcode: trimmed,
      is_primary: isPrimary,
    })
    .select(PRODUCT_BARCODE_SELECT)
    .single();

  if (error) {
    return { data: null, error: formatDbError(error) };
  }

  return { data: mapProductBarcode(data as Record<string, unknown>), error: null };
}

export interface UpdateProductBarcodeInput {
  barcode?: string;
  is_primary?: boolean;
}

/** Updates barcode value and/or primary flag. Requires `barcodes.manage` (enforced by RLS). */
export async function updateProductBarcode(
  barcodeId: string,
  input: UpdateProductBarcodeInput,
): Promise<AuthResult<ProductBarcode>> {
  const patch: Record<string, unknown> = {};
  if (input.barcode !== undefined) {
    const trimmed = input.barcode.trim();
    if (!trimmed) {
      return { data: null, error: 'Barcode cannot be empty.' };
    }
    patch.barcode = trimmed;
  }
  if (input.is_primary !== undefined) patch.is_primary = input.is_primary;

  const { data, error } = await supabase
    .from('product_barcodes')
    .update(patch)
    .eq('id', barcodeId)
    .select(PRODUCT_BARCODE_SELECT)
    .single();

  if (error) {
    return { data: null, error: formatDbError(error) };
  }

  return { data: mapProductBarcode(data as Record<string, unknown>), error: null };
}

/** Deletes a barcode row. Requires `barcodes.manage` (enforced by RLS). */
export async function deleteProductBarcode(barcodeId: string): Promise<AuthResult<null>> {
  const { error } = await supabase.from('product_barcodes').delete().eq('id', barcodeId);

  if (error) {
    return { data: null, error: formatDbError(error) };
  }

  return { data: null, error: null };
}

/** Read-only Clover sync mode from `system_settings` (staff+ via RLS). No secrets. */
export interface CloverSyncSettings {
  clover_sync_mode: CloverSyncMode;
  clover_merchant_id: string | null;
}

export async function getCloverSyncSettings(): Promise<AuthResult<CloverSyncSettings>> {
  const { data, error } = await supabase
    .from('system_settings')
    .select('clover_sync_mode, clover_merchant_id')
    .eq('id', true)
    .maybeSingle();

  if (error) {
    return { data: null, error: formatDbError(error) };
  }
  if (!data) {
    return { data: null, error: 'System settings not found.' };
  }

  const row = data as Record<string, unknown>;
  return {
    data: {
      clover_sync_mode: parseCloverSyncMode(row.clover_sync_mode),
      clover_merchant_id: row.clover_merchant_id ? String(row.clover_merchant_id) : null,
    },
    error: null,
  };
}

export { slugify };
