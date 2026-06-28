import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PERMISSION } from '@dchill/shared';
import type { Category, InventoryLogWithProduct, InventoryRecordWithProduct, ProductWithCategory } from '@dchill/types';

import { usePermissions } from '../auth/usePermissions.js';
import { CategoryManager } from '../components/inventory/CategoryManager.js';
import { InventoryAdjustmentForm } from '../components/inventory/InventoryAdjustmentForm.js';
import { InventoryLogTable } from '../components/inventory/InventoryLogTable.js';
import { ProductBarcodeManager } from '../components/inventory/ProductBarcodeManager.js';
import { ProductForm } from '../components/inventory/ProductForm.js';
import { ProductTable } from '../components/inventory/ProductTable.js';
import {
  adjustInventoryQuantityWithLog,
  createProduct,
  listCategories,
  listInventoryLogs,
  listInventoryRecords,
  listProducts,
  setProductActive,
  updateProduct,
  type CreateProductInput,
  type UpdateProductInput,
} from '../inventory/index.js';

type FormMode = 'closed' | 'create' | 'edit';

/**
 * Admin inventory foundation — products + raw counts.
 * UI permission checks are convenience only; Postgres RLS is authoritative.
 */
export function InventoryPage(): JSX.Element {
  const { loading: permissionsLoading, has, error: permissionsError } = usePermissions();

  const canReadProducts = has(PERMISSION.PRODUCTS_READ);
  const canWriteProducts = has(PERMISSION.PRODUCTS_WRITE);
  const canReadInventory = has(PERMISSION.INVENTORY_READ);
  const canWriteInventory = has(PERMISSION.INVENTORY_WRITE);
  const canManageBarcodes = has(PERMISSION.BARCODES_MANAGE);

  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [inventory, setInventory] = useState<InventoryRecordWithProduct[]>([]);
  const [inventoryLogs, setInventoryLogs] = useState<InventoryLogWithProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<FormMode>('closed');
  const [editingProduct, setEditingProduct] = useState<ProductWithCategory | null>(null);
  const [inventoryTarget, setInventoryTarget] = useState<ProductWithCategory | null>(null);
  const [barcodeProductId, setBarcodeProductId] = useState('');
  const [logFilterProductId, setLogFilterProductId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const inventoryByProductId = useMemo(() => {
    const map = new Map<string, InventoryRecordWithProduct>();
    for (const row of inventory) {
      map.set(row.product_id, row);
    }
    return map;
  }, [inventory]);

  const loadData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setPageError(null);

    const errors: string[] = [];

    if (canReadProducts) {
      const [productsResult, categoriesResult] = await Promise.all([
        listProducts(),
        listCategories(),
      ]);
      if (productsResult.error) {
        errors.push(productsResult.error);
      } else {
        setProducts(productsResult.data ?? []);
      }
      if (categoriesResult.error) {
        errors.push(categoriesResult.error);
      } else {
        setCategories(categoriesResult.data ?? []);
      }
    } else {
      setProducts([]);
      setCategories([]);
    }

    if (canReadInventory) {
      const [inventoryResult, logsResult] = await Promise.all([
        listInventoryRecords(),
        listInventoryLogs(),
      ]);
      if (inventoryResult.error) {
        errors.push(inventoryResult.error);
      } else {
        setInventory(inventoryResult.data ?? []);
      }
      if (logsResult.error) {
        errors.push(logsResult.error);
      } else {
        setInventoryLogs(logsResult.data ?? []);
      }
    } else {
      setInventory([]);
      setInventoryLogs([]);
    }

    if (errors.length > 0) {
      setPageError(errors.join(' '));
    }

    setLoading(false);
  }, [canReadProducts, canReadInventory]);

  useEffect(() => {
    if (permissionsLoading) {
      return;
    }
    void loadData();
  }, [permissionsLoading, loadData]);

  async function handleCreate(input: CreateProductInput): Promise<void> {
    setSubmitting(true);
    setActionError(null);
    const result = await createProduct(input);
    if (result.error) {
      setActionError(result.error);
      setSubmitting(false);
      return;
    }
    setFormMode('closed');
    setSubmitting(false);
    await loadData();
  }

  async function handleUpdate(input: UpdateProductInput): Promise<void> {
    if (!editingProduct) {
      return;
    }
    setSubmitting(true);
    setActionError(null);
    const result = await updateProduct(editingProduct.id, input);
    if (result.error) {
      setActionError(result.error);
      setSubmitting(false);
      return;
    }
    setFormMode('closed');
    setEditingProduct(null);
    setSubmitting(false);
    await loadData();
  }

  async function handleToggleActive(product: ProductWithCategory): Promise<void> {
    setActionError(null);
    const active = product.status !== 'hidden' && product.status !== 'admin_only';
    const result = await setProductActive(product.id, !active);
    if (result.error) {
      setActionError(result.error);
      return;
    }
    await loadData();
  }

  async function handleInventoryAdjustment(input: {
    newQuantityOnHand: number;
    reason: 'manual' | 'restock' | 'order_accepted' | 'order_canceled';
    note?: string;
  }): Promise<void> {
    if (!inventoryTarget) {
      return;
    }
    setSubmitting(true);
    setActionError(null);
    const result = await adjustInventoryQuantityWithLog({
      productId: inventoryTarget.id,
      newQuantityOnHand: input.newQuantityOnHand,
      reason: input.reason,
      note: input.note,
    });
    if (result.error) {
      setActionError(result.error);
      if (result.data?.partialFailure) {
        await loadData();
      }
      setSubmitting(false);
      return;
    }
    setInventoryTarget(null);
    setSubmitting(false);
    await loadData();
  }

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.h1}>Inventory</h1>
          <p style={styles.note}>
            Phase 2A–2C. UI permission hints below are not security — RLS in Postgres enforces
            every read and write.
          </p>
        </div>
        <Link to="/dashboard" style={styles.link}>
          ← Dashboard
        </Link>
      </header>

      {permissionsError && <p style={styles.error}>{permissionsError}</p>}
      {pageError && <p style={styles.error}>{pageError}</p>}
      {actionError && <p style={styles.error}>{actionError}</p>}

      {permissionsLoading || loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <section style={styles.section}>
            <CategoryManager
              categories={categories}
              canRead={canReadProducts}
              canWrite={canWriteProducts}
              onChanged={loadData}
            />
          </section>

          <section style={styles.section}>
            <div style={styles.sectionHeader}>
              <h2>Products</h2>
              {canWriteProducts && (
                <button
                  type="button"
                  style={styles.button}
                  onClick={() => {
                    setEditingProduct(null);
                    setFormMode('create');
                    setActionError(null);
                  }}
                >
                  New product
                </button>
              )}
            </div>

            {!canReadProducts ? (
              <p style={styles.warn}>
                UI: missing <code>products.read</code>. You may still be blocked by RLS even if
                controls appear.
              </p>
            ) : (
              <ProductTable
                products={products}
                canWrite={canWriteProducts}
                onEdit={(product) => {
                  setEditingProduct(product);
                  setFormMode('edit');
                  setActionError(null);
                }}
                onToggleActive={(product) => void handleToggleActive(product)}
              />
            )}

            {!canWriteProducts && (
              <p style={styles.warn}>
                UI: missing <code>products.write</code> — create/edit controls hidden.
              </p>
            )}
          </section>

          {formMode !== 'closed' && canWriteProducts && (
            <section style={styles.section}>
              <ProductForm
                mode={formMode === 'create' ? 'create' : 'edit'}
                categories={categories}
                initial={editingProduct}
                submitting={submitting}
                error={actionError}
                onSubmit={async (input) => {
                  if (formMode === 'create') {
                    await handleCreate(input as CreateProductInput);
                  } else {
                    await handleUpdate(input as UpdateProductInput);
                  }
                }}
                onCancel={() => {
                  setFormMode('closed');
                  setEditingProduct(null);
                  setActionError(null);
                }}
              />
            </section>
          )}

          <section style={styles.section}>
            <h2>Inventory counts</h2>
            {!canReadInventory ? (
              <p style={styles.warn}>
                UI: missing <code>inventory.read</code> — raw counts hidden (customers never see
                these in the mobile app).
              </p>
            ) : (
              <>
                <p style={styles.note}>
                  Raw on-hand counts are staff-only. Customers see derived stock status on products.
                </p>
                {inventory.length === 0 ? (
                  <p style={styles.muted}>No inventory rows yet.</p>
                ) : (
                  <ul style={styles.inventoryList}>
                    {inventory.map((row) => (
                      <li key={row.product_id} style={styles.inventoryItem}>
                        <span>
                          {row.product?.name ?? row.product_id}: {row.quantity_on_hand} on hand (
                          {row.quantity_reserved} reserved)
                        </span>
                        {canWriteInventory && (
                          <button
                            type="button"
                            style={styles.linkButton}
                            onClick={() => {
                              const product =
                                products.find((p) => p.id === row.product_id) ?? null;
                              if (product) {
                                setInventoryTarget(product);
                                setActionError(null);
                              }
                            }}
                          >
                            Update
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {canWriteProducts && products.length > 0 && canWriteInventory && (
                  <div style={styles.inventoryPick}>
                    <label style={styles.pickLabel}>
                      Set quantity for product
                      <select
                        value={inventoryTarget?.id ?? ''}
                        onChange={(e) => {
                          const product = products.find((p) => p.id === e.target.value) ?? null;
                          setInventoryTarget(product);
                          setActionError(null);
                        }}
                        style={styles.pickSelect}
                      >
                        <option value="">— Select —</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}

                {inventoryTarget && canWriteInventory && (
                  <InventoryAdjustmentForm
                    productId={inventoryTarget.id}
                    productName={inventoryTarget.name}
                    currentQuantity={
                      inventoryByProductId.get(inventoryTarget.id)?.quantity_on_hand ?? null
                    }
                    submitting={submitting}
                    error={actionError}
                    onSubmit={handleInventoryAdjustment}
                  />
                )}

                {!canWriteInventory && (
                  <p style={styles.warn}>
                    UI: missing <code>inventory.write</code> — quantity updates disabled.
                  </p>
                )}
              </>
            )}
          </section>

          <section style={styles.section}>
            <h2>Inventory history</h2>
            <p style={styles.note}>
              Append-only audit rows from <code>inventory_logs</code>. RLS allows staff SELECT;
              inserts require <code>inventory.write</code>.
            </p>
            <InventoryLogTable
              logs={inventoryLogs}
              products={products}
              filterProductId={logFilterProductId}
              onFilterProductIdChange={setLogFilterProductId}
              canRead={canReadInventory}
            />
          </section>

          <section style={styles.section}>
            <ProductBarcodeManager
              products={products}
              canReadProducts={canReadProducts}
              canManageBarcodes={canManageBarcodes}
              selectedProductId={barcodeProductId}
              onSelectProduct={setBarcodeProductId}
            />
          </section>
        </>
      )}
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: { maxWidth: 960, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' },
  h1: { margin: '0 0 0.25rem' },
  note: { color: '#555', fontSize: '0.9rem', lineHeight: 1.5, margin: 0 },
  link: { color: '#1a5f4a', textDecoration: 'none', whiteSpace: 'nowrap' },
  section: { marginTop: '1.5rem' },
  sectionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' },
  button: { padding: '0.5rem 0.85rem', cursor: 'pointer' },
  linkButton: {
    background: 'none',
    border: 'none',
    color: '#1a5f4a',
    cursor: 'pointer',
    textDecoration: 'underline',
    marginLeft: '0.75rem',
  },
  error: { color: '#b00020' },
  warn: { color: '#8a5a00', fontSize: '0.9rem' },
  muted: { color: '#666' },
  inventoryList: { listStyle: 'none', padding: 0, margin: '0.75rem 0 0' },
  inventoryItem: { padding: '0.35rem 0', borderBottom: '1px solid #eee' },
  inventoryPick: { marginTop: '1rem' },
  pickLabel: { display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.9rem' },
  pickSelect: { maxWidth: 360, padding: '0.5rem' },
};
