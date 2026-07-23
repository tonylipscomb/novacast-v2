import type { useRouter } from 'expo-router';

import { rememberMoviesScreenMemory } from '@/features/movies/moviesScreenMemory';
import type { ProviderSearchHit } from '@/features/providers/providerRepositories';
import { rememberSeriesScreenMemory } from '@/features/series/seriesScreenMemory';

type SearchRouter = ReturnType<typeof useRouter>;

export function openSearchHit(router: SearchRouter, providerId: string, hit: ProviderSearchHit) {
  if (hit.kind === 'live') {
    router.push({ pathname: '/live', params: { channelId: hit.id, returnRoute: 'search' } });
    return;
  }

  if (hit.kind === 'movie') {
    rememberMoviesScreenMemory(providerId, {
      selectedMovieId: hit.id,
      focusedMovieId: hit.id,
    });
    router.push('/movies');
    return;
  }

  rememberSeriesScreenMemory(providerId, {
    selectedSeriesId: hit.id,
    focusedSeriesId: hit.id,
  });
  router.push('/series');
}
