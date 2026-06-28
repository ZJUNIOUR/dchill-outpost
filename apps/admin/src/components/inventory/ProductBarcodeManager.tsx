import { type CSSProperties, type FormEvent, useCallback, useEffect, useState } from 'react';
import type { ProductBarcode, ProductWithCategory } from '@dchill/types';

import {
  addProductBarcode,
  deleteProductBarcode,
  listProductBarcodes,
  updateProductBarcode,
} from '../../inventory/index.js';

export interface ProductBarcodeManagerProps {
  products: ProductWithCategory[];
  canReadProducts: boolean;
  canManageBarcodes: boolean;
  selectedProductId: string;
  onSelectProduct: (productId: string) => void;
}

/**
 * Manual barcode CRUD for one product at a time (no camera scanner).
 * Writes require `barcodes.manage`; RLS is authoritative.
 */
export function ProductBarcodeManager({
  products,
  canReadProducts,
  canManageBarcodes,
  selectedProductId,
  onSelectProduct,
}: ProductBarcodeManagerProps): JSX.Element {
  const [barcodes, setBarcodes] = useState<ProductBarcode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newBarcode, setNewBarcode] = useState('');
  const [newIsPrimary, setNewIsPrimary] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBarcode, setEditBarcode] = useState('');
  const [editIsPrimary, setEditIsPrimary] = useState(false);

  const selectedProduct = products.find((p) => p.id === selectedProductId) ?? null;

  const loadBarcodes = useCallback(async (): Promise<void> => {
    if (!selectedProductId || !canReadProducts) {
      setBarcodes([]);
      return;
    }

    setLoading(true);
    setError(null);
    const result = await listProductBarcodes(selectedProductId);
    if (result.error) {
      setError(result.error);
      setBarcodes([]);
    } else {
      setBarcodes(result.data ?? []);
    }
    setLoading(false);
  }, [selectedProductId, canReadProducts]);

  useEffect(() => {
    void loadBarcodes();
  }, [loadBarcodes]);

  async function handleAdd(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canManageBarcodes || !selectedProductId || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    const result = await addProductBarcode(selectedProductId, newBarcode, newIsPrimary);
    if (result.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    setNewBarcode('');
    setNewIsPrimary(false);
    setSubmitting(false);
    await loadBarcodes();
  }

  function startEdit(row: ProductBarcode): void {
    setEditingId(row.id);
    setEditBarcode(row.barcode);
    setEditIsPrimary(row.is_primary);
    setError(null);
  }

  function cancelEdit(): void {
    setEditingId(null);
    setEditBarcode('');
    setEditIsPrimary(false);
  }

  async function handleSaveEdit(barcodeId: string): Promise<void> {
    if (!canManageBarcodes || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    const result = await updateProductBarcode(barcodeId, {
      barcode: editBarcode,
      is_primary: editIsPrimary,
    });
    if (result.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    cancelEdit();
    setSubmitting(false);
    await loadBarcodes();
  }

  async function handleDelete(barcodeId: string): Promise<void> {
    if (!canManageBarcodes || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);
    const result = await deleteProductBarcode(barcodeId);
    if (result.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    await loadBarcodes();
  }

  if (!canReadProducts) {
    return (
      <p style={styles.warn}>
        UI: missing <code>products.read</code> — barcode manager hidden.
      </p>
    );
  }

  return (
    <div>
      <h2 style={styles.h2}>Product barcodes</h2>
      <p style={styles.note}>
        Manual entry only (no scanner yet). Schema stores <code>barcode</code> and{' '}
        <code>is_primary</code> — no barcode type column. Changes require{' '}
        <code>barcodes.manage</code>; RLS enforces access.
      </p>

      <label style={styles.pickLabel}>
        Product
        <select
          value={selectedProductId}
          onChange={(e) => onSelectProduct(e.target.value)}
          style={styles.pickSelect}
        >
          <option value="">— Select product —</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      </label>

      {!selectedProductId ? (
        <p style={styles.muted}>Select a product to view or manage barcodes.</p>
      ) : loading ? (
        <p>Loading barcodes…</p>
      ) : (
        <>
          <p style={styles.meta}>
            Managing: <strong>{selectedProduct?.name ?? selectedProductId}</strong>
          </p>

          {barcodes.length === 0 ? (
            <p style={styles.muted}>No barcodes for this product.</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Barcode</th>
                  <th style={styles.th}>Primary</th>
                  {canManageBarcodes && <th style={styles.th}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {barcodes.map((row) => (
                  <tr key={row.id}>
                    {editingId === row.id ? (
                      <>
                        <td style={styles.td}>
                          <input
                            value={editBarcode}
                            onChange={(e) => setEditBarcode(e.target.value)}
                            disabled={submitting}
                            style={styles.input}
                          />
                        </td>
                        <td style={styles.td}>
                          <label style={styles.checkboxLabel}>
                            <input
                              type="checkbox"
                              checked={editIsPrimary}
                              onChange={(e) => setEditIsPrimary(e.target.checked)}
                              disabled={submitting}
                            />
                            Primary
                          </label>
                        </td>
                        <td style={styles.td}>
                          <button
                            type="button"
                            style={styles.linkButton}
                            disabled={submitting}
                            onClick={() => void handleSaveEdit(row.id)}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            style={styles.linkButton}
                            disabled={submitting}
                            onClick={cancelEdit}
                          >
                            Cancel
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={styles.td}>{row.barcode}</td>
                        <td style={styles.td}>{row.is_primary ? 'Yes' : 'No'}</td>
                        {canManageBarcodes && (
                          <td style={styles.td}>
                            <button
                              type="button"
                              style={styles.linkButton}
                              onClick={() => startEdit(row)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              style={styles.linkButton}
                              onClick={() => void handleDelete(row.id)}
                            >
                              Delete
                            </button>
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {canManageBarcodes ? (
            <form onSubmit={(e) => void handleAdd(e)} style={styles.form}>
              <h3 style={styles.formTitle}>Add barcode</h3>
              <label style={styles.label}>
                Barcode (UPC/EAN)
                <input
                  required
                  value={newBarcode}
                  onChange={(e) => setNewBarcode(e.target.value)}
                  disabled={submitting}
                  style={styles.input}
                />
              </label>
              <label style={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={newIsPrimary}
                  onChange={(e) => setNewIsPrimary(e.target.checked)}
                  disabled={submitting}
                />
                Primary barcode for this product
              </label>
              <button type="submit" disabled={submitting} style={styles.button}>
                {submitting ? 'Adding…' : 'Add barcode'}
              </button>
            </form>
          ) : (
            <p style={styles.warn}>
              UI: missing <code>barcodes.manage</code> — barcode edits disabled.
            </p>
          )}
        </>
      )}

      {error && <p style={styles.error}>{error}</p>}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  h2: { margin: '0 0 0.5rem' },
  note: { color: '#555', fontSize: '0.9rem', margin: '0 0 0.75rem', lineHeight: 1.5 },
  pickLabel: { display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.9rem' },
  pickSelect: { maxWidth: 400, padding: '0.5rem', marginBottom: '0.75rem' },
  meta: { fontSize: '0.9rem', color: '#555', margin: '0 0 0.5rem' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' },
  th: { textAlign: 'left', borderBottom: '2px solid #ddd', padding: '0.5rem' },
  td: { borderBottom: '1px solid #eee', padding: '0.5rem', verticalAlign: 'middle' },
  linkButton: {
    background: 'none',
    border: 'none',
    color: '#1a5f4a',
    cursor: 'pointer',
    textDecoration: 'underline',
    marginRight: '0.5rem',
  },
  form: {
    border: '1px solid #ddd',
    borderRadius: 8,
    padding: '1rem',
    marginTop: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    maxWidth: 420,
  },
  formTitle: { margin: 0, fontSize: '1rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.9rem' },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' },
  input: { padding: '0.5rem', fontSize: '1rem' },
  button: { alignSelf: 'flex-start', padding: '0.5rem 0.85rem', cursor: 'pointer' },
  error: { color: '#b00020', marginTop: '0.75rem' },
  warn: { color: '#8a5a00', fontSize: '0.9rem' },
  muted: { color: '#666' },
};
