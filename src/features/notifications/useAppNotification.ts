import { useMemo } from 'react';

import { clearScope, dismissNotification, showNotification } from './notificationStore';

/**
 * Stable access to the shared notification store's actions. The store itself is a plain
 * module-level singleton (consistent with `guideMemory`/`unifiedPlayerStore`), so this hook
 * doesn't need React context — it just hands back the same functions every render.
 */
export function useAppNotification() {
  return useMemo(
    () => ({
      showNotification,
      dismissNotification,
      clearScope,
    }),
    [],
  );
}
