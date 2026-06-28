import type { CSSProperties } from 'react';

import { useAuth } from '../auth/useAuth.js';

/**
 * Placeholder dashboard — no operational features yet (products, orders, inventory, etc.).
 * Shown only after authentication; data access still governed by RLS.
 */
export function DashboardPlaceholder(): JSX.Element {
  const { user, profile, signOut, error } = useAuth();

  return (
    <main style={styles.main}>
      <header style={styles.header}>
        <h1>Admin dashboard</h1>
        <button type="button" onClick={() => void signOut()} style={styles.button}>
          Sign out
        </button>
      </header>

      <p style={styles.note}>
        Phase 1D shell only. Row Level Security in Postgres is the real authority — role display
        below is for UI convenience.
      </p>

      <section style={styles.card}>
        <h2>Signed in</h2>
        <dl style={styles.dl}>
          <dt>Auth user id</dt>
          <dd>{user?.id ?? '—'}</dd>
          <dt>Email</dt>
          <dd>{user?.email ?? profile?.email ?? '—'}</dd>
          <dt>Full name</dt>
          <dd>{profile?.full_name ?? '—'}</dd>
          <dt>Role (from public.users)</dt>
          <dd>{profile?.role ?? '—'}</dd>
          <dt>Active</dt>
          <dd>{profile ? String(profile.is_active) : '—'}</dd>
        </dl>
      </section>

      <section style={styles.card}>
        <h2>Coming next</h2>
        <p>Product, inventory, pickup orders, and reports will be added in later phases.</p>
      </section>

      {error && <p style={styles.error}>{error}</p>}
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: { maxWidth: 720, margin: '2rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' },
  note: { color: '#555', fontSize: '0.9rem', lineHeight: 1.5 },
  card: {
    border: '1px solid #ddd',
    borderRadius: 8,
    padding: '1rem 1.25rem',
    marginTop: '1.25rem',
  },
  dl: { display: 'grid', gridTemplateColumns: '10rem 1fr', gap: '0.5rem 1rem', margin: 0 },
  button: { padding: '0.5rem 0.85rem', cursor: 'pointer' },
  error: { color: '#b00020' },
};
