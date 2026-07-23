import type { ProviderRepositoryBundle } from '../providers/providerBundle.ts';
import type { ProviderGuideProgram, ProviderLiveChannel } from '../providers/providerRepositories.ts';
import { displayStreamTitle } from '../series/metadata/titleNormalization.ts';
import { displayLiveProgramText } from './liveTvProgramText.ts';

const EPG_PREFETCH_COUNT = 20;
const EPG_CACHE_TTL_MS = 5 * 60 * 1000;

type CachedEpgEntry = {
  programs: ProviderGuideProgram[];
  fetchedAt: number;
};

const epgCache = new Map<string, CachedEpgEntry>();

export type EpgPrefetchOptions = {
  onChannelEnriched?: (channel: ProviderLiveChannel) => void;
};

function epgProgressFromProgram(program: ProviderGuideProgram) {
  if (!program.meta.includes(' - ')) {
    return 0;
  }

  return program.meta.includes('left') ? 50 : 0;
}

export function enrichChannelWithEpg(channel: ProviderLiveChannel, programs: ProviderGuideProgram[]): ProviderLiveChannel {
  if (!programs.length) {
    const title = displayLiveProgramText(channel.current, '');
    const channelLabel = displayStreamTitle(channel.name);
    return {
      ...channel,
      current: title && title !== channelLabel && title !== channel.name.trim() ? title : '',
    };
  }

  const now = programs[0];
  const next = programs[1];
  const following = programs[2];
  const programTitle = displayLiveProgramText(now.title, '');
  const channelLabel = displayStreamTitle(channel.name);

  return {
    ...channel,
    current: programTitle && programTitle !== channelLabel && programTitle !== channel.name.trim() ? programTitle : '',
    next: next?.title ? displayLiveProgramText(next.title, channel.next) : channel.next,
    following: following?.title ? displayLiveProgramText(following.title, channel.following) : channel.following,
    currentStart: now.start ?? channel.currentStart,
    currentEnd: now.end ?? channel.currentEnd,
    remaining: now.meta.includes('left') ? now.meta : channel.remaining,
    progress: epgProgressFromProgram(now),
    description: displayLiveProgramText(now.description, 'No program information available.'),
  };
}

export function mapChannelsWithoutEpg(channels: ProviderLiveChannel[]): ProviderLiveChannel[] {
  return channels;
}

function readCachedPrograms(channelId: string) {
  const cached = epgCache.get(channelId);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.fetchedAt > EPG_CACHE_TTL_MS) {
    epgCache.delete(channelId);
    return null;
  }

  return cached.programs;
}

function writeCachedPrograms(channelId: string, programs: ProviderGuideProgram[]) {
  epgCache.set(channelId, {
    programs,
    fetchedAt: Date.now(),
  });
}

export function clearLiveTvEpgCache() {
  epgCache.clear();
}

async function fetchProgramsForChannel(
  bundle: ProviderRepositoryBundle,
  channel: ProviderLiveChannel,
): Promise<ProviderGuideProgram[]> {
  const cached = readCachedPrograms(channel.id);
  if (cached) {
    return cached;
  }

  const programs = await bundle.live.getShortEpg(channel.id, 3, undefined, channel.epgChannelId).catch(() => []);
  writeCachedPrograms(channel.id, programs);
  return programs;
}

export async function enrichChannelsWithPrefetchedEpg(
  bundle: ProviderRepositoryBundle,
  channels: ProviderLiveChannel[],
  options?: EpgPrefetchOptions,
): Promise<ProviderLiveChannel[]> {
  if (!channels.length) {
    return channels;
  }

  const targets = channels.slice(0, EPG_PREFETCH_COUNT);
  const epgMap = new Map<string, ProviderGuideProgram[]>();

  await Promise.all(
    targets.map(async (channel) => {
      const programs = await fetchProgramsForChannel(bundle, channel);
      epgMap.set(channel.id, programs);
      options?.onChannelEnriched?.(enrichChannelWithEpg(channel, programs));
    }),
  );

  return channels.map((channel) => enrichChannelWithEpg(channel, epgMap.get(channel.id) ?? []));
}

export async function enrichSingleChannelEpg(
  bundle: ProviderRepositoryBundle,
  channel: ProviderLiveChannel,
): Promise<ProviderLiveChannel> {
  const programs = await fetchProgramsForChannel(bundle, channel);
  return enrichChannelWithEpg(channel, programs);
}
