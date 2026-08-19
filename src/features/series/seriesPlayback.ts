import type { SeriesEpisodeSummary } from '../media-browser/mediaTypes.ts';
import type { NextEpisodeRef, PlaybackItem, PlaybackLaunchSource } from '../playback/unified/types.ts';
import { sliceSeriesUpNextEpisodes, sliceSeriesPreviousEpisodes } from '../playback/continuity/seriesUpNext.ts';
import { buildEpisodePlaybackUrl } from '../providers/providerPlayback.ts';
import type { ProviderRepositoryBundle } from '../providers/providerBundle.ts';

export {
  formatSeriesContinuePlayLabel,
  resolveSeriesContinuePlayTarget,
  type SeriesContinuePlayMode,
  type SeriesContinueWatchingPointer,
} from '../playback/continuity/seriesUpNext.ts';

export function buildSeriesEpisodeSubtitle(seriesTitle: string | undefined, seasonNumber: string) {
  return seriesTitle ? `${seriesTitle} - Season ${seasonNumber}` : `Season ${seasonNumber}`;
}

export function toEpisodePlaybackRef(
  bundle: ProviderRepositoryBundle,
  episode: SeriesEpisodeSummary,
): NextEpisodeRef {
  return {
    id: episode.id,
    seriesId: episode.seriesId,
    seasonNumber: episode.seasonNumber,
    episodeNumber: episode.episodeNumber,
    title: episode.title,
    streamId: episode.streamId,
    extension: episode.extension,
    streamUrl: buildEpisodePlaybackUrl(bundle, episode.streamId, episode.extension) ?? undefined,
  };
}

export function buildNextEpisodeRef(
  bundle: ProviderRepositoryBundle,
  episodes: SeriesEpisodeSummary[],
  current: Pick<SeriesEpisodeSummary, 'seasonNumber' | 'episodeNumber'>,
): NextEpisodeRef | undefined {
  const next = sliceSeriesUpNextEpisodes(episodes, current)
    .map((episode) => toEpisodePlaybackRef(bundle, episode))
    .find((episode) => Boolean(episode.streamUrl));
  return next;
}

export function buildSeriesEpisodePlaybackItem(input: {
  bundle: ProviderRepositoryBundle;
  providerId: string;
  episode: SeriesEpisodeSummary;
  seriesTitle?: string;
  artworkUrl?: string;
  resumePositionMs?: number;
  episodes?: SeriesEpisodeSummary[];
}): PlaybackItem | null {
  const streamUrl = buildEpisodePlaybackUrl(input.bundle, input.episode.streamId, input.episode.extension);
  if (!streamUrl) {
    return null;
  }

  const upcoming = input.episodes
    ? sliceSeriesUpNextEpisodes(input.episodes, input.episode)
        .map((episode) => toEpisodePlaybackRef(input.bundle, episode))
        .filter((episode) => Boolean(episode.streamUrl))
    : [];
  const previous = input.episodes
    ? sliceSeriesPreviousEpisodes(input.episodes, input.episode).map((episode) =>
        toEpisodePlaybackRef(input.bundle, episode),
      )
    : [];

  return {
    id: input.episode.id,
    mediaType: 'episode',
    title: input.episode.title,
    subtitle: buildSeriesEpisodeSubtitle(input.seriesTitle, input.episode.seasonNumber),
    artworkUrl: input.artworkUrl,
    streamUrl,
    isLive: false,
    providerId: input.providerId,
    resumePositionMs: input.resumePositionMs,
    seriesId: input.episode.seriesId,
    seasonNumber: input.episode.seasonNumber,
    episodeNumber: input.episode.episodeNumber,
    episodeId: input.episode.id,
    nextEpisode: upcoming[0],
    previousEpisode: previous[0],
    upcomingEpisodes: upcoming.length ? upcoming : undefined,
    previousEpisodes: previous.length ? previous : undefined,
  };
}

export async function launchSeriesEpisodePlayback(input: {
  bundle: ProviderRepositoryBundle;
  providerId: string;
  episode: SeriesEpisodeSummary;
  seriesTitle?: string;
  artworkUrl?: string;
  resumePositionMs?: number;
  episodes?: SeriesEpisodeSummary[];
  launchSource?: PlaybackLaunchSource;
  resumePolicy?: 'silent' | 'prompt' | 'start';
  launchPlayback: (
    item: PlaybackItem,
    options?: {
      launchSource?: PlaybackLaunchSource;
      contentFit?: 'contain' | 'cover' | 'fill';
      resumePolicy?: 'silent' | 'prompt' | 'start';
    },
  ) => Promise<void>;
}): Promise<boolean> {
  const item = buildSeriesEpisodePlaybackItem({
    bundle: input.bundle,
    providerId: input.providerId,
    episode: input.episode,
    seriesTitle: input.seriesTitle,
    artworkUrl: input.artworkUrl,
    resumePositionMs: input.resumePositionMs,
    episodes: input.episodes,
  });

  if (!item) {
    return false;
  }

  await input.launchPlayback(item, {
    launchSource: input.launchSource ?? 'episode',
    contentFit: 'contain',
    resumePolicy: input.resumePolicy,
  });
  return true;
}
