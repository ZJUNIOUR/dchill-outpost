import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

import type { CloverCategory, CloverItem, CloverItemStock } from './cloverClient.ts';

const SYNCED_AT = (): string => new Date().toISOString();

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function cloverModifiedAtIso(modifiedTime?: number): string | null {
  if (modifiedTime === undefined || modifiedTime === null || Number.isNaN(modifiedTime)) {
    return null;
  }
  return new Date(modifiedTime).toISOString();
}

/** Clover item prices are integer cents per Platform API docs. */
export function cloverCentsToPriceString(cents?: number): string {
  if (cents === undefined || cents === null || Number.isNaN(cents)) {
    return '0.00';
  }
  return (cents / 100).toFixed(2);
}

export function mapCloverCategoryRow(category: CloverCategory): Record<string, unknown> | null {
  if (!category.id || !category.name) {
    return null;
  }

  const baseSlug = slugify(category.name) || `category-${category.id}`;
  return {
    clover_category_id: category.id,
    name: category.name,
    slug: `${baseSlug}-${category.id.slice(-6)}`,
    sort_order: category.sortOrder ?? 0,
    is_active: true,
    clover_sync_status: 'synced',
    last_synced_at: SYNCED_AT(),
    clover_modified_at: cloverModifiedAtIso(category.modifiedTime),
  };
}

export function mapCloverProductRow(
  item: CloverItem,
  categoryIdByClover: Map<string, string>,
): Record<string, unknown> | null {
  if (!item.id || !item.name) {
    return null;
  }

  const cloverCategoryId = item.categories?.elements?.[0]?.id ?? null;
  const categoryId = cloverCategoryId ? categoryIdByClover.get(cloverCategoryId) ?? null : null;
  const baseSlug = slugify(item.name) || `product-${item.id}`;

  // TODO(Phase 2F.5): conflict detection not implemented — mirror overwrites; compare clover_modified_at in Phase 2G.
  return {
    clover_item_id: item.id,
    name: item.name,
    slug: `${baseSlug}-${item.id.slice(-6)}`,
    category_id: categoryId,
    sku: item.sku ?? null,
    base_price: cloverCentsToPriceString(item.price),
    sale_price: null,
    status: item.hidden ? 'hidden' : 'in_stock',
    clover_sync_status: 'synced',
    last_synced_at: SYNCED_AT(),
    clover_modified_at: cloverModifiedAtIso(item.modifiedTime),
    updated_at: SYNCED_AT(),
  };
}

export interface BarcodeMapping {
  barcode: string;
  clover_alternate_code_id: string | null;
  is_primary: boolean;
}

/**
 * Extract barcode strings from a Clover item.
 * TODO(Phase 2F.5): validate whether `code` is UPC/EAN vs internal SKU — see docs/CLOVER_SANDBOX_SYNC_TESTING.md §8.
 */
export function extractBarcodeMappings(item: CloverItem): BarcodeMapping[] {
  const rows: BarcodeMapping[] = [];
  const seen = new Set<string>();

  if (item.code) {
    const code = item.code.trim();
    if (code) {
      rows.push({ barcode: code, clover_alternate_code_id: null, is_primary: true });
      seen.add(code);
    }
  }

  for (const alt of item.alternateCodes?.elements ?? []) {
    const code = alt.code?.trim();
    if (!code || seen.has(code)) {
      continue;
    }
    rows.push({
      barcode: code,
      clover_alternate_code_id: alt.id ?? null,
      is_primary: rows.length === 0,
    });
    seen.add(code);
  }

  return rows;
}

export function readStockQuantity(stock: CloverItemStock): number | null {
  if (stock.quantity !== undefined && stock.quantity !== null) {
    return Math.max(0, Math.trunc(stock.quantity));
  }
  if (stock.stockCount !== undefined && stock.stockCount !== null) {
    return Math.max(0, Math.trunc(stock.stockCount));
  }
  return null;
}

export async function upsertCategoryMirror(
  admin: SupabaseClient,
  row: Record<string, unknown>,
): Promise<'upserted' | 'failed'> {
  const cloverId = String(row.clover_category_id);
  const { data: existing } = await admin
    .from('categories')
    .select('id')
    .eq('clover_category_id', cloverId)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await admin.from('categories').update(row).eq('id', existing.id);
    return error ? 'failed' : 'upserted';
  }

  const { error } = await admin.from('categories').insert(row);
  return error ? 'failed' : 'upserted';
}

export async function upsertProductMirror(
  admin: SupabaseClient,
  row: Record<string, unknown>,
): Promise<{ outcome: 'upserted' | 'failed'; productId: string | null }> {
  const cloverItemId = String(row.clover_item_id);
  const { data: existing } = await admin
    .from('products')
    .select('id')
    .eq('clover_item_id', cloverItemId)
    .maybeSingle();

  if (existing?.id) {
    const { error } = await admin.from('products').update(row).eq('id', existing.id);
    return { outcome: error ? 'failed' : 'upserted', productId: existing.id as string };
  }

  const { data, error } = await admin.from('products').insert(row).select('id').single();
  if (error || !data) {
    return { outcome: 'failed', productId: null };
  }
  return { outcome: 'upserted', productId: String(data.id) };
}

export async function upsertBarcodeMirror(
  admin: SupabaseClient,
  productId: string,
  mapping: BarcodeMapping,
): Promise<'upserted' | 'failed' | 'skipped'> {
  const { data: existing } = await admin
    .from('product_barcodes')
    .select('id')
    .eq('barcode', mapping.barcode)
    .maybeSingle();

  const patch = {
    product_id: productId,
    barcode: mapping.barcode,
    is_primary: mapping.is_primary,
    clover_alternate_code_id: mapping.clover_alternate_code_id,
  };

  if (existing?.id) {
    const { error } = await admin.from('product_barcodes').update(patch).eq('id', existing.id);
    return error ? 'failed' : 'upserted';
  }

  const { error } = await admin.from('product_barcodes').insert(patch);
  return error ? 'failed' : 'upserted';
}

export interface InventorySyncOutcome {
  outcome: 'upserted' | 'failed' | 'skipped';
  productId: string | null;
  changeQty: number;
}

export async function syncInventoryForStockRow(
  admin: SupabaseClient,
  stock: CloverItemStock,
  syncRunId: string,
): Promise<InventorySyncOutcome> {
  const cloverItemId = stock.item?.id;
  if (!cloverItemId) {
    return { outcome: 'skipped', productId: null, changeQty: 0 };
  }

  const quantity = readStockQuantity(stock);
  if (quantity === null) {
    return { outcome: 'skipped', productId: null, changeQty: 0 };
  }

  const { data: product } = await admin
    .from('products')
    .select('id')
    .eq('clover_item_id', cloverItemId)
    .maybeSingle();

  if (!product?.id) {
    return { outcome: 'skipped', productId: null, changeQty: 0 };
  }

  const productId = String(product.id);
  const { data: current } = await admin
    .from('inventory')
    .select('quantity_on_hand')
    .eq('product_id', productId)
    .maybeSingle();

  const previousQty = current ? Number(current.quantity_on_hand) : 0;
  const changeQty = quantity - previousQty;
  const now = SYNCED_AT();

  const { error: invError } = await admin.from('inventory').upsert(
    {
      product_id: productId,
      quantity_on_hand: quantity,
      clover_sync_status: 'synced',
      last_synced_at: now,
      updated_at: now,
    },
    { onConflict: 'product_id' },
  );

  if (invError) {
    return { outcome: 'failed', productId, changeQty: 0 };
  }

  if (changeQty !== 0) {
    const externalRef = `clover_sync:${syncRunId}:${cloverItemId}`;
    const { error: logError } = await admin.from('inventory_logs').insert({
      product_id: productId,
      change_qty: changeQty,
      new_quantity: quantity,
      reason: 'clover_sync',
      source: 'clover_sync',
      external_ref: externalRef,
      user_id: null,
      order_id: null,
    });

    if (logError) {
      return { outcome: 'failed', productId, changeQty };
    }
  }

  return { outcome: 'upserted', productId, changeQty };
}

export interface CatalogSyncSummary {
  categoriesUpserted: number;
  categoriesFailed: number;
  productsUpserted: number;
  productsFailed: number;
  barcodesUpserted: number;
  barcodesFailed: number;
  errors: string[];
}

export async function syncCatalogMirror(
  admin: SupabaseClient,
  categories: CloverCategory[],
  items: CloverItem[],
): Promise<CatalogSyncSummary> {
  const summary: CatalogSyncSummary = {
    categoriesUpserted: 0,
    categoriesFailed: 0,
    productsUpserted: 0,
    productsFailed: 0,
    barcodesUpserted: 0,
    barcodesFailed: 0,
    errors: [],
  };

  const categoryIdByClover = new Map<string, string>();

  for (const category of categories) {
    const row = mapCloverCategoryRow(category);
    if (!row) {
      continue;
    }
    const outcome = await upsertCategoryMirror(admin, row);
    if (outcome === 'upserted') {
      summary.categoriesUpserted += 1;
      const { data } = await admin
        .from('categories')
        .select('id')
        .eq('clover_category_id', row.clover_category_id)
        .maybeSingle();
      if (data?.id) {
        categoryIdByClover.set(String(row.clover_category_id), String(data.id));
      }
    } else {
      summary.categoriesFailed += 1;
      summary.errors.push(`category ${String(row.clover_category_id)} upsert failed`);
    }
  }

  for (const item of items) {
    const row = mapCloverProductRow(item, categoryIdByClover);
    if (!row) {
      continue;
    }

    const { outcome, productId } = await upsertProductMirror(admin, row);
    if (outcome === 'upserted') {
      summary.productsUpserted += 1;
    } else {
      summary.productsFailed += 1;
      summary.errors.push(`product ${String(row.clover_item_id)} upsert failed`);
      continue;
    }

    if (!productId) {
      continue;
    }

    for (const barcode of extractBarcodeMappings(item)) {
      const barcodeOutcome = await upsertBarcodeMirror(admin, productId, barcode);
      if (barcodeOutcome === 'upserted') {
        summary.barcodesUpserted += 1;
      } else if (barcodeOutcome === 'failed') {
        summary.barcodesFailed += 1;
      }
    }
  }

  return summary;
}

export interface InventorySyncSummary {
  stocksUpserted: number;
  stocksFailed: number;
  stocksSkipped: number;
  errors: string[];
}

export async function syncInventoryMirror(
  admin: SupabaseClient,
  stocks: CloverItemStock[],
  syncRunId: string,
): Promise<InventorySyncSummary> {
  const summary: InventorySyncSummary = {
    stocksUpserted: 0,
    stocksFailed: 0,
    stocksSkipped: 0,
    errors: [],
  };

  for (const stock of stocks) {
    const result = await syncInventoryForStockRow(admin, stock, syncRunId);
    if (result.outcome === 'upserted') {
      summary.stocksUpserted += 1;
    } else if (result.outcome === 'failed') {
      summary.stocksFailed += 1;
      summary.errors.push(`stock for item ${stock.item?.id ?? 'unknown'} failed`);
    } else {
      summary.stocksSkipped += 1;
    }
  }

  return summary;
}
