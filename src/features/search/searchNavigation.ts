import type { useRouter } from 'expo-router';

import { rememberGuideMemory } from '@/features/guide/guideMemory';
import type { ProviderSearchHit } from '@/features/providers/providerRepositories';

import { rememberSearchScreenMemory } from './searchScreenMemory';
import type { SearchResult, SearchScope } from './searchTypes';

type SearchRouter = ReturnType<typeof useRouter>;

type SearchNavigationContext = {
  query?: string;
  scope?: SearchScope;
  focusedResultKey?: string | null;
};

function rememberSearchContext(providerId: string, context?: SearchNavigationContext) {
  if (!context) {
    return;
  }

  rememberSearchScreenMemory(providerId, {
    query: context.query ?? '',
    scope: context.scope ?? 'all',
    focusedResultKey: context.focusedResultKey ?? null,
  });
}

export function openSearchHit(router: SearchRouter, providerId: string, hit: ProviderSearchHit) {
  if (hit.kind === 'live') {
    router.push({ pathname: '/live', params: { channelId: hit.id, returnRoute: 'search' } });
    return;
  }

  router.push({
    pathname: '/search',
    params: {
      query: hit.title,
      scope: hit.kind === 'movie' ? 'movie' : hit.kind === 'series' ? 'series' : 'all',
      mediaId: hit.id,
    },
  });
}

export function openSearchResult(
  router: SearchRouter,
  providerId: string,
  result: SearchResult,
  context?: SearchNavigationContext,
) {
  rememberSearchContext(providerId, context);

  if (result.type === 'live') {
    router.push({ pathname: '/live', params: { channelId: result.id, returnRoute: 'search' } });
    return;
  }

  if (result.type === 'guide') {
    rememberGuideMemory(providerId, {
      selectedChannelId: result.channelId,
      selectedProgramId: result.programId,
      searchQuery: '',
      focusedChannelId: result.channelId,
    });
    router.push({
      pathname: '/guide',
      params: {
        channelId: result.channelId,
        programId: result.programId,
        startsAt: result.startsAt ? String(result.startsAt) : undefined,
      },
    });
  }
}
