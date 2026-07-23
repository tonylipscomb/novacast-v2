import { useEffect, useState } from 'react';

import {
  getActiveRepositoryBundle,
  getRepositoryBundleGeneration,
  subscribeRepositoryBundle,
  type ProviderRepositoryBundle,
} from './providerBundle';

export function useActiveProviderBundle() {
  const [bundle, setBundle] = useState<ProviderRepositoryBundle | null>(() => getActiveRepositoryBundle());
  const [generation, setGeneration] = useState(() => getRepositoryBundleGeneration());

  useEffect(() => {
    const unsubscribe = subscribeRepositoryBundle(() => {
      setBundle(getActiveRepositoryBundle());
      setGeneration(getRepositoryBundleGeneration());
    });

    return unsubscribe;
  }, []);

  return { bundle, generation, isXtream: bundle?.connectionType === 'xtream' };
}
