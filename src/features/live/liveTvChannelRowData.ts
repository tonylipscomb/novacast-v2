import type { ProviderLiveChannel } from '../providers/providerRepositories.ts';
import { displayStreamTitle } from '../series/metadata/titleNormalization.ts';
import { LIVE_TV_NO_PROGRAM_LABEL, resolveLiveTvNowPlaying } from './liveTvProgramText.ts';

/** Stable row shell — EPG text/progress live in LiveTvChannelEpgInfo. */
export type LiveTvChannelRowShellData = {
  id: string;
  number: number;
  name: string;
  shortName: string;
  tone: string;
  resolution: string;
  logoUrl?: string;
};

export type LiveTvChannelEpgData = {
  current: string;
  progress: number;
};

/** @deprecated Use LiveTvChannelRowShellData — kept for FlatList typing during migration. */
export type LiveTvChannelRowData = LiveTvChannelRowShellData;

export function toLiveTvChannelRowShell(channel: ProviderLiveChannel): LiveTvChannelRowShellData {
  const name = displayStreamTitle(channel.name);
  return {
    id: channel.id,
    number: channel.number,
    name,
    shortName: channel.shortName,
    tone: channel.tone,
    resolution: channel.resolution,
    logoUrl: channel.logoUrl,
  };
}

export function toLiveTvChannelEpgData(channel: ProviderLiveChannel): LiveTvChannelEpgData {
  const current = resolveLiveTvNowPlaying(channel.current, channel.name);
  return {
    current: current === LIVE_TV_NO_PROGRAM_LABEL ? '' : current,
    progress: channel.progress,
  };
}

function shellFieldsEqual(previous: LiveTvChannelRowShellData, next: LiveTvChannelRowShellData): boolean {
  return (
    previous.id === next.id &&
    previous.number === next.number &&
    previous.name === next.name &&
    previous.shortName === next.shortName &&
    previous.tone === next.tone &&
    previous.resolution === next.resolution &&
    previous.logoUrl === next.logoUrl
  );
}

const rowShellPool = new Map<string, LiveTvChannelRowShellData>();
const rowEpgPool = new Map<string, LiveTvChannelEpgData>();

export function buildLiveTvChannelRowShellList(channels: ProviderLiveChannel[]): LiveTvChannelRowShellData[] {
  const activeIds = new Set<string>();

  const rows = channels.map((channel) => {
    const candidate = toLiveTvChannelRowShell(channel);
    activeIds.add(candidate.id);
    const cached = rowShellPool.get(candidate.id);
    if (cached && shellFieldsEqual(cached, candidate)) {
      return cached;
    }

    rowShellPool.set(candidate.id, candidate);
    return candidate;
  });

  for (const id of rowShellPool.keys()) {
    if (!activeIds.has(id)) {
      rowShellPool.delete(id);
    }
  }

  return rows;
}

export function buildLiveTvChannelEpgMap(channels: ProviderLiveChannel[]): Map<string, LiveTvChannelEpgData> {
  const activeIds = new Set<string>();
  const nextMap = new Map<string, LiveTvChannelEpgData>();

  for (const channel of channels) {
    const candidate = toLiveTvChannelEpgData(channel);
    activeIds.add(channel.id);
    const cached = rowEpgPool.get(channel.id);
    if (cached && cached.current === candidate.current && cached.progress === candidate.progress) {
      nextMap.set(channel.id, cached);
      continue;
    }

    rowEpgPool.set(channel.id, candidate);
    nextMap.set(channel.id, candidate);
  }

  for (const id of rowEpgPool.keys()) {
    if (!activeIds.has(id)) {
      rowEpgPool.delete(id);
    }
  }

  return nextMap;
}

/** @deprecated Use buildLiveTvChannelRowShellList */
export function buildLiveTvChannelRowDataList(channels: ProviderLiveChannel[]): LiveTvChannelRowShellData[] {
  return buildLiveTvChannelRowShellList(channels);
}

/** @deprecated Use toLiveTvChannelRowShell */
export function toLiveTvChannelRowData(channel: ProviderLiveChannel): LiveTvChannelRowShellData {
  return toLiveTvChannelRowShell(channel);
}

export function clearLiveTvChannelRowDataPool() {
  rowShellPool.clear();
  rowEpgPool.clear();
}

/**
 * Apply enriched EPG without replacing channel objects whose shell fields are unchanged.
 */
export function mergeLiveTvChannelEpg(
  previous: ProviderLiveChannel[],
  enriched: ProviderLiveChannel[],
): ProviderLiveChannel[] {
  if (!enriched.length) {
    return previous;
  }

  if (!previous.length) {
    return enriched;
  }

  const enrichedById = new Map(enriched.map((channel) => [channel.id, channel]));

  return previous.map((previousChannel) => {
    const nextChannel = enrichedById.get(previousChannel.id);
    if (!nextChannel) {
      return previousChannel;
    }

    if (
      previousChannel.current === nextChannel.current &&
      previousChannel.progress === nextChannel.progress &&
      previousChannel.next === nextChannel.next &&
      previousChannel.following === nextChannel.following &&
      previousChannel.currentStart === nextChannel.currentStart &&
      previousChannel.currentEnd === nextChannel.currentEnd &&
      previousChannel.remaining === nextChannel.remaining &&
      previousChannel.description === nextChannel.description
    ) {
      return previousChannel;
    }

    return {
      ...previousChannel,
      current: nextChannel.current,
      next: nextChannel.next,
      following: nextChannel.following,
      currentStart: nextChannel.currentStart,
      currentEnd: nextChannel.currentEnd,
      remaining: nextChannel.remaining,
      progress: nextChannel.progress,
      description: nextChannel.description,
    };
  });
}
