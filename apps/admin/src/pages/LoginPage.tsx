import { type CSSProperties, type FormEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from '../auth/useAuth.js';

export function LoginPage(): JSX.Element {
  const { loading, user, signIn, error: authError } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const from =
    (location.state as { from?: string } | null)?.from ?? '/dashboard';

  if (!loading && user) {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await signIn(email.trim(), password);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={styles.main}>
      <h1>DChill Outpost — Admin</h1>
      <p style={styles.note}>
        Staff sign-in only. Database RLS enforces what you can access — UI checks are not
        sufficient alone.
      </p>
      <form onSubmit={(e) => void handleSubmit(e)} style={styles.form}>
        <label style={styles.label}>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input}
          />
        </label>
        <label style={styles.label}>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input}
          />
        </label>
        {(formError ?? authError) && <p style={styles.error}>{formError ?? authError}</p>}
        <button type="submit" disabled={submitting || loading} style={styles.button}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  main: { maxWidth: 420, margin: '4rem auto', padding: '0 1rem', fontFamily: 'system-ui, sans-serif' },
  note: { color: '#555', fontSize: '0.9rem', lineHeight: 1.5 },
  form: { display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' },
  label: { display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.9rem' },
  input: { padding: '0.5rem 0.65rem', fontSize: '1rem' },
  button: { padding: '0.6rem', fontSize: '1rem', cursor: 'pointer' },
  error: { color: '#b00020', margin: 0 },
};
