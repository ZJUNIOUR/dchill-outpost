import type { Category, CloverSyncStatus, Product } from '@dchill/types';

/** Compact read-only label for product Clover mapping (ID preferred, else sync status). */
export function formatProductCloverLabel(product: Pick<Product, 'clover_item_id' | 'clover_sync_status'>): string {
  if (product.clover_item_id) {
    return product.clover_item_id;
  }
  return formatCloverSyncStatus(product.clover_sync_status);
}

/** Compact read-only label for category Clover mapping. */
export function formatCategoryCloverLabel(
  category: Pick<Category, 'clover_category_id' | 'clover_sync_status'>,
): string {
  if (category.clover_category_id) {
    return category.clover_category_id;
  }
  return formatCloverSyncStatus(category.clover_sync_status);
}

export function formatCloverSyncStatus(status: CloverSyncStatus): string {
  return status.replace(/_/g, ' ');
}
