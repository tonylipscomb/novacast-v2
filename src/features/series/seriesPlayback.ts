import type { SeriesEpisodeSummary } from '../media-browser/mediaTypes.ts';
import type { PlaybackItem, PlaybackLaunchSource } from '../playback/unified/types.ts';
import { buildEpisodePlaybackUrl } from '../providers/providerPlayback.ts';
import type { ProviderRepositoryBundle } from '../providers/providerBundle.ts';

export function buildSeriesEpisodeSubtitle(seriesTitle: string | undefined, seasonNumber: string) {
  return seriesTitle ? `${seriesTitle} - Season ${seasonNumber}` : `Season ${seasonNumber}`;
}

export function buildSeriesEpisodePlaybackItem(input: {
  bundle: ProviderRepositoryBundle;
  providerId: string;
  episode: SeriesEpisodeSummary;
  seriesTitle?: string;
  artworkUrl?: string;
  resumePositionMs?: number;
}): PlaybackItem | null {
  const streamUrl = buildEpisodePlaybackUrl(input.bundle, input.episode.streamId, input.episode.extension);
  if (!streamUrl) {
    return null;
  }

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
  };
}

export async function launchSeriesEpisodePlayback(input: {
  bundle: ProviderRepositoryBundle;
  providerId: string;
  episode: SeriesEpisodeSummary;
  seriesTitle?: string;
  artworkUrl?: string;
  resumePositionMs?: number;
  launchSource?: PlaybackLaunchSource;
  launchPlayback: (
    item: PlaybackItem,
    options?: { launchSource?: PlaybackLaunchSource; contentFit?: 'contain' | 'cover' | 'fill' },
  ) => Promise<void>;
}): Promise<boolean> {
  const item = buildSeriesEpisodePlaybackItem({
    bundle: input.bundle,
    providerId: input.providerId,
    episode: input.episode,
    seriesTitle: input.seriesTitle,
    artworkUrl: input.artworkUrl,
    resumePositionMs: input.resumePositionMs,
  });

  if (!item) {
    return false;
  }

  await input.launchPlayback(item, {
    launchSource: input.launchSource ?? 'episode',
    contentFit: 'contain',
  });
  return true;
}
