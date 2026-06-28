import { type CSSProperties, type FormEvent, useState } from 'react';

export interface InventoryQuantityFormProps {
  productId: string;
  productName: string;
  currentQuantity: number | null;
  disabled?: boolean;
  submitting?: boolean;
  error?: string | null;
  onSubmit: (quantity: number) => Promise<void>;
}

/** Sets on-hand quantity for one product via `updateInventoryQuantity` (RLS enforced). */
export function InventoryQuantityForm({
  productId,
  productName,
  currentQuantity,
  disabled = false,
  submitting = false,
  error = null,
  onSubmit,
}: InventoryQuantityFormProps): JSX.Element {
  const [quantity, setQuantity] = useState(
    currentQuantity === null ? '' : String(currentQuantity),
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (disabled || submitting) {
      return;
    }

    const parsed = Number.parseInt(quantity, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return;
    }

    await onSubmit(parsed);
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} style={styles.form}>
      <h3 style={styles.title}>Update inventory</h3>
      <p style={styles.meta}>
        Product: <strong>{productName}</strong> ({productId})
      </p>
      <p style={styles.meta}>
        Current on hand: {currentQuantity === null ? 'No inventory row yet' : currentQuantity}
      </p>

      <label style={styles.label}>
        Quantity on hand
        <input
          required
          inputMode="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          disabled={disabled || submitting}
          style={styles.input}
        />
      </label>

      {error && <p style={styles.error}>{error}</p>}

      <button type="submit" disabled={disabled || submitting} style={styles.button}>
        {submitting ? 'Saving…' : 'Update quantity'}
      </button>
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
  meta: { margin: 0, fontSize: '0.9rem', color: '#555' },
  label: { display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.9rem' },
  input: { padding: '0.5rem 0.65rem', fontSize: '1rem', maxWidth: 200 },
  button: { alignSelf: 'flex-start', padding: '0.5rem 0.85rem', cursor: 'pointer' },
  error: { color: '#b00020', margin: 0 },
};
