import { useEffect, useMemo, useState } from 'react';
import type { PermissionKey, RolePermissionState } from '@dchill/types';

import { getUserPermissions } from './index.js';

/**
 * Loads permission keys for UI gating only.
 * RLS is authoritative — lacking a permission here does not guarantee denial,
 * and having it does not guarantee access if RLS blocks the row.
 */
export function usePermissions(): RolePermissionState & {
  has: (key: PermissionKey) => boolean;
} {
  const [state, setState] = useState<RolePermissionState>({
    role: null,
    permissions: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;

    void getUserPermissions().then((result) => {
      if (!cancelled) {
        setState({ ...result, loading: false });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const has = useMemo(
    () => (key: PermissionKey) => state.permissions.includes(key),
    [state.permissions],
  );

  return { ...state, has };
}
