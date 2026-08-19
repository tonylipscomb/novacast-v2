import { useEffect, useState } from 'react';

import { subscribeMediaLibrary } from '../media-browser/mediaLibraryStore.ts';
import { subscribeMovieLibrary } from '../movies/smart/movieLibraryStore.ts';

import {
  emptyDiscoverZoneSnapshot,
  loadDiscoverZoneSnapshot,
  type DiscoverZoneScope,
  type DiscoverZoneSnapshot,
} from './discoverZoneModel.ts';
import { subscribePersonalization } from './personalizationStore.ts';

export function useDiscoverZone(providerId: string, scope: DiscoverZoneScope, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<DiscoverZoneSnapshot>(() => emptyDiscoverZoneSnapshot(scope));

  useEffect(() => {
    if (!enabled || !providerId) {
      setSnapshot(emptyDiscoverZoneSnapshot(scope));
      return;
    }

    let active = true;
    const refresh = () => {
      void loadDiscoverZoneSnapshot(providerId, scope).then((next) => {
        if (active) {
          setSnapshot(next);
        }
      });
    };

    refresh();
    const unsubscribers = [
      subscribeMovieLibrary(refresh),
      subscribeMediaLibrary(refresh),
      subscribePersonalization(refresh),
    ];

    return () => {
      active = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [enabled, providerId, scope]);

  return snapshot;
}
