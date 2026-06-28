import type { CSSProperties } from 'react';
import type { ProductStatus, ProductWithCategory } from '@dchill/types';

import { formatProductCloverLabel } from './cloverDisplay.js';

export function isProductCustomerVisible(status: ProductStatus): boolean {
  return status !== 'hidden' && status !== 'admin_only';
}

function formatPrice(basePrice: string, salePrice: string | null): string {
  if (salePrice !== null && salePrice !== '') {
    return `$${salePrice} (was $${basePrice})`;
  }
  return `$${basePrice}`;
}

export interface ProductTableProps {
  products: ProductWithCategory[];
  canWrite: boolean;
  onEdit: (product: ProductWithCategory) => void;
  onToggleActive: (product: ProductWithCategory) => void;
}

/** Read-only product list with optional edit/active actions (UI-gated; RLS enforces writes). */
export function ProductTable({
  products,
  canWrite,
  onEdit,
  onToggleActive,
}: ProductTableProps): JSX.Element {
  if (products.length === 0) {
    return <p style={styles.empty}>No products found.</p>;
  }

  return (
    <div style={styles.wrap}>
      <table style={styles.table}>
        <thead>
          <tr>
            <th style={styles.th}>Name</th>
            <th style={styles.th}>SKU</th>
            <th style={styles.th}>Category</th>
            <th style={styles.th}>Price</th>
            <th style={styles.th}>Active</th>
            <th style={styles.th}>Status</th>
            <th style={styles.th}>Clover</th>
            {canWrite && <th style={styles.th}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {products.map((product) => {
            const active = isProductCustomerVisible(product.status);
            return (
              <tr key={product.id}>
                <td style={styles.td}>{product.name}</td>
                <td style={styles.td}>{product.sku ?? '—'}</td>
                <td style={styles.td}>{product.category?.name ?? '—'}</td>
                <td style={styles.td}>{formatPrice(product.base_price, product.sale_price)}</td>
                <td style={styles.td}>{active ? 'Yes' : 'No'}</td>
                <td style={styles.td}>{product.status}</td>
                <td style={styles.td}>
                  <span style={styles.cloverLabel} title={product.clover_item_id ? 'Clover item ID' : 'Sync status'}>
                    {formatProductCloverLabel(product)}
                  </span>
                </td>
                {canWrite && (
                  <td style={styles.td}>
                    <button type="button" style={styles.linkButton} onClick={() => onEdit(product)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      style={styles.linkButton}
                      onClick={() => onToggleActive(product)}
                    >
                      {active ? 'Hide' : 'Show'}
                    </button>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  wrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' },
  th: {
    textAlign: 'left',
    borderBottom: '2px solid #ddd',
    padding: '0.5rem',
    whiteSpace: 'nowrap',
  },
  td: { borderBottom: '1px solid #eee', padding: '0.5rem', verticalAlign: 'top' },
  linkButton: {
    background: 'none',
    border: 'none',
    color: '#1a5f4a',
    cursor: 'pointer',
    padding: '0 0.5rem 0 0',
    textDecoration: 'underline',
  },
  empty: { color: '#666' },
  cloverLabel: { fontSize: '0.85rem', color: '#444', fontFamily: 'ui-monospace, monospace' },
};
