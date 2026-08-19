import type { SeriesSummary } from '../media-browser/mediaTypes.ts';

export const WATCHLIST_LAUNCH_MARKER = 'rc-watchlist-launch-series-detail';

export type HomeWatchlistLaunchEvent =
  | 'press'
  | 'canonical-resolved'
  | 'series-detail-open'
  | 'resolution-failed';

export type HomeWatchlistSeriesLaunchDecision =
  | {
      kind: 'open-series-detail';
      mediaType: 'series';
      series: SeriesSummary;
    }
  | {
      kind: 'resolution-failed';
      mediaType: 'series';
      remainOnHome: true;
    };

function trimId(value: string | undefined | null): string {
  return String(value ?? '').trim();
}

export function isActionableWatchlistSeries(series: Partial<SeriesSummary> | null | undefined): series is SeriesSummary {
  const id = trimId(series?.id);
  const seriesId = trimId(series?.seriesId) || id;
  const title = String(series?.title ?? '').trim();
  return Boolean(id && seriesId && title);
}

/** Reuse the hydrated Home SeriesSummary; do not invent a second Series entity. */
export function decideHomeWatchlistSeriesLaunch(
  series: Partial<SeriesSummary> | null | undefined,
): HomeWatchlistSeriesLaunchDecision {
  if (!isActionableWatchlistSeries(series)) {
    return { kind: 'resolution-failed', mediaType: 'series', remainOnHome: true };
  }
  const id = trimId(series.id);
  const seriesId = trimId(series.seriesId) || id;
  return {
    kind: 'open-series-detail',
    mediaType: 'series',
    series: {
      ...series,
      id,
      seriesId,
      categoryId: series.categoryId ?? '',
      genres: Array.isArray(series.genres) ? series.genres : [],
      posterStyleKey: series.posterStyleKey ?? 'ember',
    },
  };
}

export function logWatchlistLaunch(payload: {
  event: HomeWatchlistLaunchEvent;
  mediaType: 'series';
  providerIdPresent: boolean;
  savedIdPresent: boolean;
  canonicalContentIdPresent: boolean;
  providerSeriesIdPresent: boolean;
}) {
  console.info(
    '[NovaCast Watchlist Launch] ' +
      JSON.stringify({
        marker: WATCHLIST_LAUNCH_MARKER,
        event: payload.event,
        mediaType: 'series',
        providerIdPresent: payload.providerIdPresent === true,
        savedIdPresent: payload.savedIdPresent === true,
        canonicalContentIdPresent: payload.canonicalContentIdPresent === true,
        providerSeriesIdPresent: payload.providerSeriesIdPresent === true,
      }),
  );
}
