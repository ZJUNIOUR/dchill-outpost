import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import { useAuth } from '../auth/useAuth.js';

/**
 * Gate for authenticated routes. Redirects to /login when there is no session.
 * Authorization for data/actions is enforced by RLS — not by this component.
 */
export function ProtectedRoute({ children }: { children: ReactNode }): JSX.Element {
  const { loading, user } = useAuth();
  const location = useLocation();

  if (loading) {
    return <p style={{ padding: '2rem' }}>Loading session…</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
