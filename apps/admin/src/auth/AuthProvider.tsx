import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthUser, UserProfile } from '@dchill/types';

import { getCurrentUser, getUserProfile, signInWithEmail, signOut as authSignOut } from './index.js';
import { supabase } from '../lib/supabase.js';

export interface AuthContextValue {
  loading: boolean;
  user: AuthUser | null;
  profile: UserProfile | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Session state for the admin shell. Uses the anon-key Supabase client only.
 * RLS in Postgres is the authoritative security layer — UI role display is convenience only.
 */
export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const userResult = await getCurrentUser();
    if (userResult.error) {
      setUser(null);
      setProfile(null);
      setError(userResult.error);
      setLoading(false);
      return;
    }

    setUser(userResult.data);
    if (!userResult.data) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const profileResult = await getUserProfile();
    setProfile(profileResult.data);
    if (profileResult.error) {
      setError(profileResult.error);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void refresh();
    });
    return () => {
      subscription.unsubscribe();
    };
  }, [refresh]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<void> => {
      setError(null);
      const result = await signInWithEmail(email, password);
      if (result.error) {
        throw new Error(result.error);
      }
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(async (): Promise<void> => {
    setError(null);
    const result = await authSignOut();
    if (result.error) {
      setError(result.error);
      return;
    }
    setUser(null);
    setProfile(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ loading, user, profile, error, signIn, signOut, refresh }),
    [loading, user, profile, error, signIn, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
