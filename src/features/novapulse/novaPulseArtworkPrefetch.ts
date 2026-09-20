import type { NovaPulseItem } from './novaPulseTypes';
import { normalizeTvRemoteImageUri } from '../../components/media/tvRemoteImageUri.ts';
import type { ImageRef } from 'expo-image';

export type NovaPulseArtworkProbeApi = {
  prefetch: (url: string, options: { cachePolicy: 'disk' }) => Promise<boolean>;
  getCachePathAsync: (cacheKey: string) => Promise<string | null>;
  readFromCacheAsync: (cacheKey: string) => Promise<ImageRef | null>;
  loadAsync: (source: { uri: string }) => Promise<ImageRef>;
};

export type NovaPulseArtworkPrefetchResult = {
  requested: number;
  completed: number;
  failed: number;
  cachePresent: number;
  cacheMissing: number;
  cacheReadSuccess: number;
  decodeSuccess: number;
  decodeFailed: number;
  decodeRequested: number;
  phase: 'final';
  selectedRemoteArtworkCount: number;
  deduped: number;
  prefetchRenderUriMatch: boolean;
  customCacheKeyUsed: false;
  cacheKeyMatch: true;
};

export type NovaPulseArtworkPrefetchProbeResult = NovaPulseArtworkPrefetchResult & {
  cacheRefs: ReadonlyMap<string, ImageRef>;
};

export type NovaPulseArtworkPrefetchPlan = {
  urls: string[];
  selectedRemoteArtworkCount: number;
  deduped: number;
  signature: string;
};

/** Builds a bounded prefetch plan from the already-composed NovaPulse feed. */
export function createNovaPulseArtworkPrefetchPlan(items: readonly NovaPulseItem[], providerId: string): NovaPulseArtworkPrefetchPlan {
  const selected = items
    .map((item) => ({ id: item.id, uri: normalizeTvRemoteImageUri(item.artworkUrl) }))
    .filter((entry): entry is { id: string; uri: string } => Boolean(entry.uri));
  const urls = [...new Set(selected.map((entry) => entry.uri))];
  const signature = `${providerId}|${selected.map((entry) => `${entry.id}|${entry.uri}`).join('|')}`;
  return {
    urls,
    selectedRemoteArtworkCount: urls.length,
    deduped: Math.max(0, selected.length - urls.length),
    signature,
  };
}

/** Runs bounded probes for the already-composed, selected artwork only. */
export async function inspectNovaPulseArtworkPrefetch(
  items: readonly NovaPulseItem[],
  plan: NovaPulseArtworkPrefetchPlan,
  image: NovaPulseArtworkProbeApi,
): Promise<NovaPulseArtworkPrefetchProbeResult> {
  const selectedMovieSeriesUrls = [...new Set(
    items
      .filter((item) => item.type === 'movie' || item.type === 'series')
      .map((item) => normalizeTvRemoteImageUri(item.artworkUrl))
      .filter((uri): uri is string => Boolean(uri)),
  )];
  const cacheRefs = new Map<string, ImageRef>();
  const results = await Promise.all(plan.urls.map(async (url) => {
    try {
      const completed = await image.prefetch(url, { cachePolicy: 'disk' });
      if (completed !== true) {
        return { completed: 0, failed: 1, cachePresent: 0, cacheMissing: 0, cacheReadSuccess: 0 };
      }
      const cachePath = await image.getCachePathAsync(url).catch(() => null);
      const cacheRead = await image.readFromCacheAsync(url).catch(() => null);
      if (cacheRead) cacheRefs.set(url, cacheRead);
      return {
        completed: 1,
        failed: 0,
        cachePresent: cachePath ? 1 : 0,
        cacheMissing: cachePath ? 0 : 1,
        cacheReadSuccess: cacheRead ? 1 : 0,
      };
    } catch {
      return { completed: 0, failed: 1, cachePresent: 0, cacheMissing: 0, cacheReadSuccess: 0 };
    }
  }));
  const decodeResults = await Promise.all(selectedMovieSeriesUrls.map(async (uri) => {
    try {
      await image.loadAsync({ uri });
      return true;
    } catch {
      return false;
    }
  }));
  return {
    requested: plan.urls.length,
    completed: results.reduce((sum, result) => sum + result.completed, 0),
    failed: results.reduce((sum, result) => sum + result.failed, 0),
    cachePresent: results.reduce((sum, result) => sum + result.cachePresent, 0),
    cacheMissing: results.reduce((sum, result) => sum + result.cacheMissing, 0),
    cacheReadSuccess: results.reduce((sum, result) => sum + result.cacheReadSuccess, 0),
    decodeSuccess: decodeResults.filter(Boolean).length,
    decodeFailed: decodeResults.filter((value) => !value).length,
    decodeRequested: decodeResults.length,
    phase: 'final',
    selectedRemoteArtworkCount: plan.selectedRemoteArtworkCount,
    deduped: plan.deduped,
    prefetchRenderUriMatch: plan.urls.every((url) => normalizeTvRemoteImageUri(url) === url),
    customCacheKeyUsed: false,
    cacheKeyMatch: true,
    cacheRefs,
  };
}
