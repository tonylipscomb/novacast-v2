import { logPlaybackSourceDiagnostics, normalizePlaybackExtension, resolveMovieContainerExtension } from './playbackSourceDiagnostics.ts';
import type { ProviderRepositoryBundle } from './providerBundle';
import type { ProviderLiveChannel } from './providerRepositories';

export function buildLiveChannelPlaybackUrl(
  bundle: ProviderRepositoryBundle,
  channel: Pick<ProviderLiveChannel, 'id' | 'streamUrl' | 'containerExtension'>,
  extension?: string,
) {
  const directSource = channel.streamUrl?.trim();
  if (directSource && /^https?:\/\//i.test(directSource)) {
    return directSource;
  }

  const url = bundle.streamUrlBuilder.buildLiveStreamUrl(
    channel.id,
    normalizePlaybackExtension(extension ?? channel.containerExtension, 'ts'),
  );
  logPlaybackSourceDiagnostics({ mediaType: 'live', url, streamId: channel.id });
  return url;
}

export function buildMoviePlaybackUrl(
  bundle: ProviderRepositoryBundle,
  streamId: string,
  extension?: string,
) {
  const hasContainerExtension = Boolean(String(extension ?? '').trim());
  const url = bundle.streamUrlBuilder.buildVodStreamUrl(
    streamId,
    normalizePlaybackExtension(extension, 'mp4'),
  );
  logPlaybackSourceDiagnostics({
    mediaType: 'movie',
    url,
    streamId,
    extensionRaw: extension,
    extensionSource: hasContainerExtension ? 'container' : 'fallback',
  });
  return url;
}

/**
 * Build movie playback URL using the canonical extension resolution order:
 * 1. VOD-info container extension (from get_vod_info.movie_data.container_extension)
 * 2. List container extension (from VOD list response)
 * 3. Bounded fallback default
 */
export function buildMoviePlaybackUrlResolved(
  bundle: ProviderRepositoryBundle,
  streamId: string,
  vodInfoExtension: string | undefined | null,
  listExtension: string | undefined | null,
): string | null {
  const resolved = resolveMovieContainerExtension(vodInfoExtension, listExtension);
  const extension = resolved ?? 'mp4';
  const url = bundle.streamUrlBuilder.buildVodStreamUrl(streamId, extension);
  logPlaybackSourceDiagnostics({
    mediaType: 'movie',
    url,
    streamId,
    extensionRaw: resolved,
    extensionSource: resolved ? 'container' : 'fallback',
  });
  return url;
}

export function buildEpisodePlaybackUrl(
  bundle: ProviderRepositoryBundle,
  streamId: string | number,
  extension = 'ts',
) {
  const url = bundle.streamUrlBuilder.buildSeriesStreamUrl(streamId, normalizePlaybackExtension(extension, 'ts'));
  logPlaybackSourceDiagnostics({
    mediaType: 'series',
    url,
    streamId,
    extensionRaw: extension,
    extensionSource: String(extension ?? '').trim() ? 'container' : 'fallback',
  });
  return url;
}
