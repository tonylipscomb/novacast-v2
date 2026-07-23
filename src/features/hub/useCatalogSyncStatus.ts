import { useEffect, useState } from 'react';

import {
  subscribeCatalogSyncPhase,
  type CatalogSyncPhase,
} from '@/features/providers/providerCatalogSync';

export function useCatalogSyncStatus(providerId: string) {
  const [phase, setPhase] = useState<CatalogSyncPhase>('idle');

  useEffect(() => {
    return subscribeCatalogSyncPhase(providerId, setPhase);
  }, [providerId]);

  return phase;
}

export function isDiscoverCollectionsPending(phase: CatalogSyncPhase) {
  return phase === 'syncing' || phase === 'smart-building';
}
