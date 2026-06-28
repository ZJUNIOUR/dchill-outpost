import type { CSSProperties } from 'react';
import type { InventoryLogWithProduct, ProductWithCategory } from '@dchill/types';

function formatTimestamp(value: string): string {
  try {
    return new Date(value).toLocaleString('en-US', { timeZone: 'America/New_York' });
  } catch {
    return value;
  }
}

function formatChangeQty(value: number): string {
  if (value > 0) {
    return `+${value}`;
  }
  return String(value);
}

export interface InventoryLogTableProps {
  logs: InventoryLogWithProduct[];
  products: ProductWithCategory[];
  filterProductId: string;
  onFilterProductIdChange: (productId: string) => void;
  canRead: boolean;
}

/** Read-only inventory adjustment history (RLS: staff SELECT on `inventory_logs`). */
export function InventoryLogTable({
  logs,
  products,
  filterProductId,
  onFilterProductIdChange,
  canRead,
}: InventoryLogTableProps): JSX.Element {
  if (!canRead) {
    return (
      <p style={styles.warn}>
        UI: missing <code>inventory.read</code> — log history hidden.
      </p>
    );
  }

  const filtered = filterProductId
    ? logs.filter((row) => row.product_id === filterProductId)
    : logs;

  return (
    <div>
      <label style={styles.filterLabel}>
        Filter by product
        <select
          value={filterProductId}
          onChange={(e) => onFilterProductIdChange(e.target.value)}
          style={styles.filterSelect}
        >
          <option value="">All products</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      </label>

      {filtered.length === 0 ? (
        <p style={styles.muted}>No inventory log entries yet.</p>
      ) : (
        <div style={styles.wrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>When</th>
                <th style={styles.th}>Product</th>
                <th style={styles.th}>Change</th>
                <th style={styles.th}>New qty</th>
                <th style={styles.th}>Reason</th>
                <th style={styles.th}>Actor</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td style={styles.td}>{formatTimestamp(row.created_at)}</td>
                  <td style={styles.td}>{row.product?.name ?? row.product_id}</td>
                  <td style={styles.td}>{formatChangeQty(row.change_qty)}</td>
                  <td style={styles.td}>{row.new_quantity}</td>
                  <td style={styles.td}>{row.reason}</td>
                  <td style={styles.td}>
                    {row.actor?.full_name ?? row.actor?.email ?? row.user_id ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  filterLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
    fontSize: '0.9rem',
    marginBottom: '0.75rem',
  },
  filterSelect: { maxWidth: 360, padding: '0.5rem' },
  wrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' },
  th: {
    textAlign: 'left',
    borderBottom: '2px solid #ddd',
    padding: '0.5rem',
    whiteSpace: 'nowrap',
  },
  td: { borderBottom: '1px solid #eee', padding: '0.5rem', verticalAlign: 'top' },
  warn: { color: '#8a5a00', fontSize: '0.9rem' },
  muted: { color: '#666' },
};
