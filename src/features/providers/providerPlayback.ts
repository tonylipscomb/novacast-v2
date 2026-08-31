import {
  getRememberedAccountOutputFormats,
  logAccountOutputFormatPropagation,
  mergeAccountOutputFormats,
} from './accountOutputFormats.ts';
import { LIVE_VLC_USER_AGENT, scheduleLiveRequestContractAudit } from './livePlaybackRequestContract.ts';
import {
  describeSafeLivePathShape,
  getCachedLivePlaybackProbe,
  LIVE_URL_CONTRACT_DIAG,
  resolveLivePlaybackExtension,
  scheduleLiveUrlContractProbe,
  type LivePlaybackExtensionResolution,
} from './livePlaybackUrlContract.ts';
import { logLiveDirectSourcePlaybackDecision, resolveUsableLiveDirectSource } from './liveStreamRowDiagnostics.ts';
import { logPlaybackSourceDiagnostics, normalizePlaybackExtension, resolveMovieContainerExtension } from './playbackSourceDiagnostics.ts';
import type { ProviderRepositoryBundle } from './providerBundle';
import type { ProviderLiveChannel } from './providerRepositories';

function resolveLivePlaybackExtensionFromBundle(
  bundle: ProviderRepositoryBundle,
  channel: Pick<ProviderLiveChannel, 'id' | 'streamUrl' | 'containerExtension'>,
  extension?: string,
): LivePlaybackExtensionResolution {
  const account = mergeAccountOutputFormats(
    bundle.accountMetadata,
    getRememberedAccountOutputFormats(bundle.providerId),
  );
  logAccountOutputFormatPropagation({
    stage: 'hydrated-playback',
    outputFormatKeyPresent: Boolean(account?.allowedOutputFormats?.length || account?.preferredOutputFormat),
    outputFormatValueKind: account?.allowedOutputFormats?.length ? 'array' : 'missing',
    allowedOutputFormats: account?.allowedOutputFormats,
    preferredOutputFormat: account?.preferredOutputFormat ?? null,
  });
  return resolveLivePlaybackExtension({
    explicitExtension: extension,
    channelContainerExtension: channel.containerExtension,
    preferredOutputFormat: account?.preferredOutputFormat,
    allowedOutputFormats: account?.allowedOutputFormats,
    cachedProbe: getCachedLivePlaybackProbe(bundle.providerId),
  });
}

function logLiveUrlContract(input: {
  url: string;
  streamId: string | number;
  resolution: LivePlaybackExtensionResolution;
  sourceShape: string;
}) {
  const path = describeSafeLivePathShape(input.url);
  console.info(LIVE_URL_CONTRACT_DIAG, {
    endpointFamily: path.endpointFamily ?? 'live',
    protocol: path.protocol,
    hostnameHash: path.hostnameHash,
    pathShape: path.pathShape,
    pathSegmentCount: path.pathSegmentCount,
    streamId: String(input.streamId).trim(),
    extension: path.finalExtension,
    providerOutputMetadataPresent: input.resolution.providerOutputMetadataPresent,
    channelContainerMetadataPresent: input.resolution.channelContainerMetadataPresent,
    constructedFormatMatchesContract: input.resolution.constructedFormatMatchesContract,
    preferredOutputFormat: input.resolution.preferredOutputFormat,
    allowedOutputFormatCount: input.resolution.allowedOutputFormatCount,
    extensionSource: input.resolution.source,
    sourceShape: input.sourceShape,
  });
  logPlaybackSourceDiagnostics({
    mediaType: 'live',
    url: input.url,
    streamId: input.streamId,
    extensionRaw: input.resolution.preferredOutputFormat ?? input.resolution.extension,
    extensionSource: input.resolution.source,
    sourceShape: input.sourceShape,
    pathShape: path.pathShape,
    providerOutputMetadataPresent: input.resolution.providerOutputMetadataPresent,
    channelContainerMetadataPresent: input.resolution.channelContainerMetadataPresent,
    constructedFormatMatchesContract: input.resolution.constructedFormatMatchesContract,
    preferredOutputFormat: input.resolution.preferredOutputFormat,
    allowedOutputFormatCount: input.resolution.allowedOutputFormatCount,
  });
}

export function buildLiveChannelPlaybackUrl(
  bundle: ProviderRepositoryBundle,
  channel: Pick<ProviderLiveChannel, 'id' | 'streamUrl' | 'containerExtension'>,
  extension?: string,
) {
  const usableDirectSource = resolveUsableLiveDirectSource(channel.streamUrl);
  if (usableDirectSource) {
    const resolution = resolveLivePlaybackExtensionFromBundle(bundle, channel, extension);
    logLiveDirectSourcePlaybackDecision({
      streamId: channel.id,
      rawDirectSource: channel.streamUrl,
      selectedAsPlaybackSource: true,
      sourcePrecedence: 'direct_source',
    });
    logLiveUrlContract({
      url: usableDirectSource,
      streamId: channel.id,
      resolution,
      sourceShape: 'direct_source',
    });
    return usableDirectSource;
  }

  const resolution = resolveLivePlaybackExtensionFromBundle(bundle, channel, extension);
  logLiveDirectSourcePlaybackDecision({
    streamId: channel.id,
    rawDirectSource: channel.streamUrl,
    selectedAsPlaybackSource: false,
    sourcePrecedence: resolution.source,
  });
  const url = bundle.streamUrlBuilder.buildLiveStreamUrl(channel.id, resolution.extension);
  logLiveUrlContract({
    url,
    streamId: channel.id,
    resolution,
    sourceShape: 'xtream-live-family',
  });
  if (bundle.connectionType === 'xtream' && bundle.providerId) {
    void Promise.resolve(
      scheduleLiveUrlContractProbe({
        providerId: bundle.providerId,
        constructedUrl: url,
        constructedExtension: resolution.extension,
      }),
    ).finally(() => {
      scheduleLiveRequestContractAudit({
        providerId: bundle.providerId,
        constructedUrl: url,
      });
    });
  }
  return url;
}

export type LivePlaybackSource = {
  uri: string;
  headers: Record<string, string>;
};

export function buildLiveChannelPlaybackSource(
  bundle: ProviderRepositoryBundle,
  channel: Pick<ProviderLiveChannel, 'id' | 'streamUrl' | 'containerExtension'>,
  extension?: string,
): LivePlaybackSource {
  return {
    uri: buildLiveChannelPlaybackUrl(bundle, channel, extension),
    headers: { 'User-Agent': LIVE_VLC_USER_AGENT },
  };
}

export function warmLivePlaybackUrlContract(
  bundle: ProviderRepositoryBundle,
  channel: Pick<ProviderLiveChannel, 'id' | 'streamUrl' | 'containerExtension'>,
) {
  if (bundle.connectionType !== 'xtream' || !bundle.providerId) {
    return;
  }
  void bundle.ready
    .catch(() => undefined)
    .then(() => {
      if (resolveUsableLiveDirectSource(channel.streamUrl)) {
        return;
      }
      const resolution = resolveLivePlaybackExtensionFromBundle(bundle, channel);
      const url = bundle.streamUrlBuilder.buildLiveStreamUrl(channel.id, resolution.extension);
      void Promise.resolve(
        scheduleLiveUrlContractProbe({
          providerId: bundle.providerId,
          constructedUrl: url,
          constructedExtension: resolution.extension,
        }),
      ).finally(() => {
        scheduleLiveRequestContractAudit({
          providerId: bundle.providerId,
          constructedUrl: url,
        });
      });
    });
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
