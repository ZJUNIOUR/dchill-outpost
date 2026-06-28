import { type CSSProperties, useEffect, useState } from 'react';
import { effectiveCloverSyncMode } from '@dchill/types';

import { getCloverSyncSettings, type CloverSyncSettings } from '../../inventory/index.js';

/**
 * Read-only banner: current Clover sync mode + Phase 2A–2C local-dev warning.
 * Does not call Clover APIs; reads `system_settings` only (RLS: staff+).
 */
export function CloverSyncBanner(): JSX.Element {
  const [settings, setSettings] = useState<CloverSyncSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      setLoading(true);
      const result = await getCloverSyncSettings();
      if (cancelled) {
        return;
      }
      if (result.error) {
        setError(result.error);
        setSettings(null);
      } else {
        setSettings(result.data);
        setError(null);
      }
      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const mode = settings?.clover_sync_mode ?? null;
  const effectiveMode = mode !== null ? effectiveCloverSyncMode(mode) : null;
  const showEffective = mode !== null && effectiveMode !== mode;

  return (
    <aside style={styles.banner} aria-label="Clover sync status">
      <strong style={styles.title}>Clover sync (read-only)</strong>
      {loading ? (
        <p style={styles.text}>Loading sync mode…</p>
      ) : error ? (
        <p style={styles.text}>
          Could not load <code>system_settings</code> — RLS may block this role. Direct Supabase
          writes on this page remain temporary local-dev behavior only.
        </p>
      ) : (
        <p style={styles.text}>
          Sync mode: <code>{mode}</code>
          {showEffective && (
            <>
              {' '}
              (effective: <code>{effectiveMode}</code>)
            </>
          )}
          {settings?.clover_merchant_id && (
            <>
              {' '}
              · Merchant ID: <code>{settings.clover_merchant_id}</code>
            </>
          )}
        </p>
      )}
      <p style={styles.warn}>
        Phase 2A–2C catalog and stock writes on this page go <strong>directly to Supabase</strong>{' '}
        — temporary local-dev behavior only. Production inventory and catalog mutations will go
        through Edge Functions to <strong>Clover first</strong>, then mirror to Supabase (Phase
        2F–2G). Clover API integration has not started yet.
      </p>
    </aside>
  );
}

const styles: Record<string, CSSProperties> = {
  banner: {
    border: '1px solid #c5d9d2',
    background: '#f4faf7',
    borderRadius: 8,
    padding: '0.85rem 1rem',
    marginBottom: '1rem',
    fontSize: '0.9rem',
    lineHeight: 1.5,
  },
  title: { display: 'block', marginBottom: '0.35rem' },
  text: { margin: '0 0 0.5rem', color: '#333' },
  warn: { margin: 0, color: '#5a4a00' },
};
