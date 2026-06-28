import { type CSSProperties, type FormEvent, useEffect, useState } from 'react';
import type { Category, ProductStatus, ProductWithCategory } from '@dchill/types';

import type { CreateProductInput, UpdateProductInput } from '../../inventory/index.js';

const PRODUCT_STATUS_OPTIONS: readonly ProductStatus[] = [
  'in_stock',
  'low_stock',
  'out_of_stock',
  'hidden',
  'admin_only',
];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface ProductFormProps {
  mode: 'create' | 'edit';
  categories: Category[];
  initial?: ProductWithCategory | null;
  disabled?: boolean;
  submitting?: boolean;
  error?: string | null;
  onSubmit: (input: CreateProductInput | UpdateProductInput) => Promise<void>;
  onCancel: () => void;
}

/** Basic product create/edit form — submits through inventory helpers only. */
export function ProductForm({
  mode,
  categories,
  initial,
  disabled = false,
  submitting = false,
  error = null,
  onSubmit,
  onCancel,
}: ProductFormProps): JSX.Element {
  const [name, setName] = useState(initial?.name ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [sku, setSku] = useState(initial?.sku ?? '');
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? '');
  const [basePrice, setBasePrice] = useState(initial?.base_price ?? '');
  const [salePrice, setSalePrice] = useState(initial?.sale_price ?? '');
  const [status, setStatus] = useState<ProductStatus>(initial?.status ?? 'in_stock');
  const [slugTouched, setSlugTouched] = useState(mode === 'edit');

  useEffect(() => {
    if (!slugTouched && mode === 'create') {
      setSlug(slugify(name));
    }
  }, [name, slugTouched, mode]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (disabled || submitting) {
      return;
    }

    const payload = {
      name: name.trim(),
      slug: slug.trim() || slugify(name),
      sku: sku.trim() || null,
      category_id: categoryId || null,
      base_price: basePrice.trim(),
      sale_price: salePrice.trim() || null,
      status,
    };

    await onSubmit(payload);
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} style={styles.form}>
      <h3 style={styles.title}>{mode === 'create' ? 'New product' : 'Edit product'}</h3>

      <label style={styles.label}>
        Name
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={disabled || submitting}
          style={styles.input}
        />
      </label>

      <label style={styles.label}>
        Slug
        <input
          required
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value);
          }}
          disabled={disabled || submitting}
          style={styles.input}
        />
      </label>

      <label style={styles.label}>
        SKU
        <input
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          disabled={disabled || submitting}
          style={styles.input}
        />
      </label>

      <label style={styles.label}>
        Category
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          disabled={disabled || submitting}
          style={styles.input}
        >
          <option value="">— None —</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </label>

      <label style={styles.label}>
        Base price
        <input
          required
          inputMode="decimal"
          value={basePrice}
          onChange={(e) => setBasePrice(e.target.value)}
          disabled={disabled || submitting}
          style={styles.input}
        />
      </label>

      <label style={styles.label}>
        Sale price (optional)
        <input
          inputMode="decimal"
          value={salePrice}
          onChange={(e) => setSalePrice(e.target.value)}
          disabled={disabled || submitting}
          style={styles.input}
        />
      </label>

      <label style={styles.label}>
        Status
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ProductStatus)}
          disabled={disabled || submitting}
          style={styles.input}
        >
          {PRODUCT_STATUS_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.actions}>
        <button type="submit" disabled={disabled || submitting} style={styles.primary}>
          {submitting ? 'Saving…' : mode === 'create' ? 'Create product' : 'Save changes'}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting} style={styles.secondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const styles: Record<string, CSSProperties> = {
  form: {
    border: '1px solid #ddd',
    borderRadius: 8,
    padding: '1rem 1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  title: { margin: 0 },
  label: { display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.9rem' },
  input: { padding: '0.5rem 0.65rem', fontSize: '1rem' },
  actions: { display: 'flex', gap: '0.5rem', marginTop: '0.25rem' },
  primary: { padding: '0.5rem 0.85rem', cursor: 'pointer' },
  secondary: { padding: '0.5rem 0.85rem', cursor: 'pointer' },
  error: { color: '#b00020', margin: 0 },
};
