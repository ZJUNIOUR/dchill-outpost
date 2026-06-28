import { type CSSProperties, type FormEvent, useState } from 'react';
import type { InventoryLogReason } from '@dchill/types';

import { INVENTORY_ADJUSTMENT_NON_ATOMIC, INVENTORY_LOG_REASONS } from '../../inventory/index.js';

const ADJUSTMENT_REASONS: readonly InventoryLogReason[] = ['manual', 'restock'];

export interface InventoryAdjustmentFormProps {
  productId: string;
  productName: string;
  currentQuantity: number | null;
  disabled?: boolean;
  submitting?: boolean;
  error?: string | null;
  onSubmit: (input: {
    newQuantityOnHand: number;
    reason: InventoryLogReason;
    note?: string;
  }) => Promise<void>;
}

/**
 * Stock adjustment with reason/note written to `inventory_logs`.
 * Uses non-atomic client helpers — see `INVENTORY_ADJUSTMENT_NON_ATOMIC`.
 */
export function InventoryAdjustmentForm({
  productId,
  productName,
  currentQuantity,
  disabled = false,
  submitting = false,
  error = null,
  onSubmit,
}: InventoryAdjustmentFormProps): JSX.Element {
  const [quantity, setQuantity] = useState(
    currentQuantity === null ? '' : String(currentQuantity),
  );
  const [reason, setReason] = useState<InventoryLogReason>('manual');
  const [note, setNote] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (disabled || submitting) {
      return;
    }

    const parsed = Number.parseInt(quantity, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return;
    }

    await onSubmit({ newQuantityOnHand: parsed, reason, note: note.trim() || undefined });
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} style={styles.form}>
      <h3 style={styles.title}>Adjust stock (with log)</h3>
      <p style={styles.meta}>
        Product: <strong>{productName}</strong> ({productId})
      </p>
      <p style={styles.meta}>
        Current on hand: {currentQuantity === null ? 'No inventory row yet' : currentQuantity}
      </p>
      <p style={styles.warning}>{INVENTORY_ADJUSTMENT_NON_ATOMIC}</p>

      <label style={styles.label}>
        New quantity on hand
        <input
          required
          inputMode="numeric"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          disabled={disabled || submitting}
          style={styles.input}
        />
      </label>

      <label style={styles.label}>
        Reason
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as InventoryLogReason)}
          disabled={disabled || submitting}
          style={styles.input}
        >
          {ADJUSTMENT_REASONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <label style={styles.label}>
        Note (optional, appended to reason)
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={disabled || submitting}
          style={styles.input}
          placeholder="e.g. damaged units removed"
        />
      </label>

      <p style={styles.hint}>
        Other log reasons ({INVENTORY_LOG_REASONS.filter((r) => !ADJUSTMENT_REASONS.includes(r)).join(', ')})
        are written by order flows later.
      </p>

      {error && <p style={styles.error}>{error}</p>}

      <button type="submit" disabled={disabled || submitting} style={styles.button}>
        {submitting ? 'Saving…' : 'Adjust & log'}
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
  warning: {
    margin: 0,
    fontSize: '0.85rem',
    color: '#8a5a00',
    lineHeight: 1.4,
    padding: '0.5rem 0.65rem',
    background: '#fff8e6',
    borderRadius: 4,
  },
  label: { display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.9rem' },
  input: { padding: '0.5rem 0.65rem', fontSize: '1rem', maxWidth: 400 },
  hint: { margin: 0, fontSize: '0.8rem', color: '#777' },
  button: { alignSelf: 'flex-start', padding: '0.5rem 0.85rem', cursor: 'pointer' },
  error: { color: '#b00020', margin: 0 },
};
