import { type CSSProperties, type FormEvent, useEffect, useState } from 'react';
import type { Category } from '@dchill/types';

import {
  createCategory,
  setCategoryActive,
  slugify,
  updateCategory,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from '../../inventory/index.js';
import { formatCategoryCloverLabel } from './cloverDisplay.js';

type FormMode = 'closed' | 'create' | 'edit';

export interface CategoryManagerProps {
  categories: Category[];
  canRead: boolean;
  canWrite: boolean;
  onChanged: () => Promise<void>;
}

/**
 * Category list + create/edit/active toggle.
 * Category writes use `products.write` per RLS — UI mirrors that permission.
 */
export function CategoryManager({
  categories,
  canRead,
  canWrite,
  onChanged,
}: CategoryManagerProps): JSX.Element {
  const [formMode, setFormMode] = useState<FormMode>('closed');
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slugTouched && formMode === 'create') {
      setSlug(slugify(name));
    }
  }, [name, slugTouched, formMode]);

  function openCreate(): void {
    setEditing(null);
    setName('');
    setSlug('');
    setSortOrder('0');
    setSlugTouched(false);
    setError(null);
    setFormMode('create');
  }

  function openEdit(category: Category): void {
    setEditing(category);
    setName(category.name);
    setSlug(category.slug);
    setSortOrder(String(category.sort_order));
    setSlugTouched(true);
    setError(null);
    setFormMode('edit');
  }

  function closeForm(): void {
    setFormMode('closed');
    setEditing(null);
    setError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canWrite || submitting) {
      return;
    }

    setSubmitting(true);
    setError(null);

    const sort_order = Number.parseInt(sortOrder, 10);
    if (!Number.isInteger(sort_order)) {
      setError('Sort order must be a whole number.');
      setSubmitting(false);
      return;
    }

    const payload = {
      name: name.trim(),
      slug: slug.trim() || slugify(name),
      sort_order,
    };

    const result =
      formMode === 'create'
        ? await createCategory(payload as CreateCategoryInput)
        : editing
          ? await updateCategory(editing.id, payload as UpdateCategoryInput)
          : { data: null, error: 'No category selected.' };

    if (result.error) {
      setError(result.error);
      setSubmitting(false);
      return;
    }

    closeForm();
    setSubmitting(false);
    await onChanged();
  }

  async function handleToggleActive(category: Category): Promise<void> {
    if (!canWrite) {
      return;
    }
    setError(null);
    const result = await setCategoryActive(category.id, !category.is_active);
    if (result.error) {
      setError(result.error);
      return;
    }
    await onChanged();
  }

  if (!canRead) {
    return (
      <p style={styles.warn}>
        UI: missing <code>products.read</code> — category list hidden.
      </p>
    );
  }

  return (
    <div>
      <div style={styles.header}>
        <h2 style={styles.h2}>Categories</h2>
        {canWrite && (
          <button type="button" style={styles.button} onClick={openCreate}>
            New category
          </button>
        )}
      </div>

      <p style={styles.note}>
        Category create/edit uses <code>products.write</code> (RLS on <code>categories</code>).
        UI checks are not security.
      </p>

      {categories.length === 0 ? (
        <p style={styles.muted}>No categories yet.</p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Slug</th>
              <th style={styles.th}>Sort</th>
              <th style={styles.th}>Active</th>
              <th style={styles.th}>Clover</th>
              {canWrite && <th style={styles.th}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr key={category.id}>
                <td style={styles.td}>{category.name}</td>
                <td style={styles.td}>{category.slug}</td>
                <td style={styles.td}>{category.sort_order}</td>
                <td style={styles.td}>{category.is_active ? 'Yes' : 'No'}</td>
                <td style={styles.td}>
                  <span
                    style={styles.cloverLabel}
                    title={category.clover_category_id ? 'Clover category ID' : 'Sync status'}
                  >
                    {formatCategoryCloverLabel(category)}
                  </span>
                </td>
                {canWrite && (
                  <td style={styles.td}>
                    <button
                      type="button"
                      style={styles.linkButton}
                      onClick={() => openEdit(category)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      style={styles.linkButton}
                      onClick={() => void handleToggleActive(category)}
                    >
                      {category.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!canWrite && (
        <p style={styles.warn}>
          UI: missing <code>products.write</code> — category edits disabled.
        </p>
      )}

      {formMode !== 'closed' && canWrite && (
        <form onSubmit={(e) => void handleSubmit(e)} style={styles.form}>
          <h3 style={styles.formTitle}>
            {formMode === 'create' ? 'New category' : 'Edit category'}
          </h3>
          <label style={styles.label}>
            Name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
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
              disabled={submitting}
              style={styles.input}
            />
          </label>
          <label style={styles.label}>
            Sort order
            <input
              required
              inputMode="numeric"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              disabled={submitting}
              style={styles.input}
            />
          </label>
          {error && <p style={styles.error}>{error}</p>}
          <div style={styles.actions}>
            <button type="submit" disabled={submitting} style={styles.button}>
              {submitting ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={closeForm} disabled={submitting} style={styles.button}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && formMode === 'closed' && <p style={styles.error}>{error}</p>}
    </div>
  );
}

const styles: Record<string, CSSProperties> = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' },
  h2: { margin: 0 },
  note: { color: '#555', fontSize: '0.9rem', margin: '0.5rem 0' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', marginTop: '0.5rem' },
  th: { textAlign: 'left', borderBottom: '2px solid #ddd', padding: '0.5rem' },
  td: { borderBottom: '1px solid #eee', padding: '0.5rem' },
  linkButton: {
    background: 'none',
    border: 'none',
    color: '#1a5f4a',
    cursor: 'pointer',
    textDecoration: 'underline',
    marginRight: '0.5rem',
  },
  button: { padding: '0.5rem 0.85rem', cursor: 'pointer' },
  form: {
    border: '1px solid #ddd',
    borderRadius: 8,
    padding: '1rem',
    marginTop: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  formTitle: { margin: 0 },
  label: { display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.9rem' },
  input: { padding: '0.5rem', fontSize: '1rem', maxWidth: 400 },
  actions: { display: 'flex', gap: '0.5rem' },
  error: { color: '#b00020', margin: 0 },
  warn: { color: '#8a5a00', fontSize: '0.9rem' },
  muted: { color: '#666' },
  cloverLabel: { fontSize: '0.85rem', color: '#444', fontFamily: 'ui-monospace, monospace' },
};
