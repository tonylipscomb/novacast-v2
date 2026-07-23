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

  return bundle.streamUrlBuilder.buildLiveStreamUrl(
    channel.id,
    extension ?? channel.containerExtension ?? 'ts',
  );
}

export function buildMoviePlaybackUrl(bundle: ProviderRepositoryBundle, streamId: string, extension = 'mp4') {
  return bundle.streamUrlBuilder.buildVodStreamUrl(streamId, extension);
}

export function buildEpisodePlaybackUrl(
  bundle: ProviderRepositoryBundle,
  streamId: string | number,
  extension = 'ts',
) {
  return bundle.streamUrlBuilder.buildSeriesStreamUrl(streamId, extension);
}
