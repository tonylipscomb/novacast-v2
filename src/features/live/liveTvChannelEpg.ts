import type { ProviderRepositoryBundle } from '../providers/providerBundle.ts';
import type { ProviderGuideProgram, ProviderLiveChannel } from '../providers/providerRepositories.ts';
import { displayStreamTitle } from '../series/metadata/titleNormalization.ts';
import { displayLiveProgramText } from './liveTvProgramText.ts';
import { CURRENT_PROGRAM_OVERLAY_TTL_MS, selectCurrentEpgProgram } from './liveProgramFreshness.ts';
import {
  getLiveTvWorkload,
  noteLiveEpgRequestCancelled,
  noteLiveEpgRequestFinished,
  noteLiveEpgRequestStarted,
  shouldSuspendLiveListEpg,
} from './liveTvWorkload.ts';

export const LIVE_EPG_WINDOW_RADIUS = 3;
export const LIVE_EPG_FOCUS_DEBOUNCE_MS = 280;
export const LIVE_EPG_FETCH_CONCURRENCY = 1;
export const EPG_CACHE_TTL_MS = CURRENT_PROGRAM_OVERLAY_TTL_MS;

type CachedEpgEntry = {
  programs: ProviderGuideProgram[];
  fetchedAt: number;
};

const epgCache = new Map<string, CachedEpgEntry>();
const inFlight = new Map<string, Promise<ProviderGuideProgram[]>>();
let epgGeneration = 0;

export type EpgPrefetchOptions = {
  onChannelEnriched?: (channel: ProviderLiveChannel) => void;
  focusedChannelId?: string | null;
  generation?: number;
};

export type FocusedEpgIssueDecision = 'issue' | 'debounce' | 'deduped' | 'cache-hit' | 'suspended';

function logLiveEpg(event: string, payload: Record<string, unknown> = {}) {
  console.info('[NovaCast Live EPG]', {
    event,
    ...payload,
  });
}

function epgProgressFromProgram(program: ProviderGuideProgram) {
  if (!program.meta.includes(' - ')) {
    return 0;
  }

  return program.meta.includes('left') ? 50 : 0;
}

export function enrichChannelWithEpg(channel: ProviderLiveChannel, programs: ProviderGuideProgram[], fetchedAt = Date.now()): ProviderLiveChannel {
  const selection = selectCurrentEpgProgram(programs);
  if (!programs.length) {
    return {
      ...channel,
      current: '',
      currentProgramFetchedAt: fetchedAt,
      currentStartAt: undefined,
      currentEndAt: undefined,
      epgSource: 'xtream-short-epg',
    };
  }

  const now = selection.program;
  const future = programs.filter((program) => program.startAt == null || program.startAt > Date.now());
  const next = future[0];
  const following = future[1];
  if (!now) {
    logLiveEpg('stale-program-rejected', { channelId: channel.id, epgChannelId: channel.epgChannelId ?? null, epgSource: 'xtream-short-epg', fetchedAt, ageMs: Date.now() - fetchedAt, staleProgramRejected: selection.staleProgramRejected });
  }
  const programTitle = displayLiveProgramText(now?.title, '');
  const channelLabel = displayStreamTitle(channel.name);

  return {
    ...channel,
    current: now && programTitle && programTitle !== channelLabel && programTitle !== channel.name.trim() ? programTitle : '',
    next: next?.title ? displayLiveProgramText(next.title, channel.next) : channel.next,
    following: following?.title ? displayLiveProgramText(following.title, channel.following) : channel.following,
    currentStart: now?.start ?? channel.currentStart,
    currentEnd: now?.end ?? channel.currentEnd,
    currentProgramFetchedAt: fetchedAt,
    currentStartAt: now?.startAt,
    currentEndAt: now?.endAt,
    epgSource: 'xtream-short-epg',
    remaining: now?.meta.includes('left') ? now.meta : channel.remaining,
    progress: now ? epgProgressFromProgram(now) : 0,
    description: now ? displayLiveProgramText(now.description, 'No program information available.') : channel.description,
  };
}

export function mapChannelsWithoutEpg(channels: ProviderLiveChannel[]): ProviderLiveChannel[] {
  return channels;
}

export function selectVisibleEpgWindow<T extends { id: string }>(
  channels: readonly T[],
  focusedId?: string | null,
  radius = LIVE_EPG_WINDOW_RADIUS,
): T[] {
  if (!channels.length) {
    return [];
  }

  const found = focusedId ? channels.findIndex((channel) => channel.id === focusedId) : 0;
  const index = found < 0 ? 0 : found;
  const start = Math.max(0, index - radius);
  const end = Math.min(channels.length, index + radius + 1);
  return channels.slice(start, end);
}

export function shouldIssueFocusedEpgRequest(input: {
  channelId: string;
  lastIssuedChannelId?: string | null;
  lastIssuedAtMs?: number | null;
  nowMs: number;
  inFlight: boolean;
  cached: boolean;
  suspended: boolean;
  debounceMs?: number;
}): FocusedEpgIssueDecision {
  if (input.suspended) {
    return 'suspended';
  }
  if (input.cached) {
    return 'cache-hit';
  }
  if (input.inFlight) {
    return 'deduped';
  }
  if (
    input.lastIssuedChannelId === input.channelId &&
    input.lastIssuedAtMs != null &&
    input.nowMs - input.lastIssuedAtMs < (input.debounceMs ?? LIVE_EPG_FOCUS_DEBOUNCE_MS)
  ) {
    return 'debounce';
  }
  return 'issue';
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

export function cancelLiveTvEpgWork(reason = 'superseded') {
  const pending = inFlight.size;
  epgGeneration += 1;
  if (pending > 0) {
    noteLiveEpgRequestCancelled(pending);
    logLiveEpg('cancelled', {
      reason,
      count: pending,
      generation: epgGeneration,
    });
  }
  return epgGeneration;
}

export function getLiveTvEpgGeneration() {
  return epgGeneration;
}

async function fetchProgramsForChannel(
  bundle: ProviderRepositoryBundle,
  channel: ProviderLiveChannel,
): Promise<ProviderGuideProgram[]> {
  const cached = readCachedPrograms(channel.id);
  if (cached) {
    logLiveEpg('cache-hit', { channelId: channel.id, empty: cached.length === 0 });
    return cached;
  }

  const existing = inFlight.get(channel.id);
  if (existing) {
    logLiveEpg('deduped', { channelId: channel.id });
    return existing;
  }

  const generation = epgGeneration;
  logLiveEpg('request-start', { channelId: channel.id, generation });
  noteLiveEpgRequestStarted();
  const request = bundle.live
    .getShortEpg(channel.id, 3, undefined, channel.epgChannelId)
    .catch(() => [] as ProviderGuideProgram[])
    .then((programs) => {
      writeCachedPrograms(channel.id, programs);
      logLiveEpg('completed', {
        channelId: channel.id,
        programCount: programs.length,
        empty: programs.length === 0,
        generation,
        stale: generation !== epgGeneration,
      });
      return programs;
    })
    .finally(() => {
      if (inFlight.get(channel.id) === request) {
        inFlight.delete(channel.id);
      }
      noteLiveEpgRequestFinished();
    });

  inFlight.set(channel.id, request);
  return request;
}

export async function enrichChannelsWithPrefetchedEpg(
  bundle: ProviderRepositoryBundle,
  channels: ProviderLiveChannel[],
  options?: EpgPrefetchOptions,
): Promise<ProviderLiveChannel[]> {
  if (!channels.length) {
    return channels;
  }

  if (shouldSuspendLiveListEpg(getLiveTvWorkload())) {
    logLiveEpg('cancelled', { reason: 'list-prefetch-suspended', channelCount: channels.length });
    return channels;
  }

  const generation = options?.generation ?? epgGeneration;
  const targets = selectVisibleEpgWindow(channels, options?.focusedChannelId);
  const epgMap = new Map<string, ProviderGuideProgram[]>();

  for (const channel of targets) {
    if (generation !== epgGeneration || shouldSuspendLiveListEpg(getLiveTvWorkload())) {
      noteLiveEpgRequestCancelled(1);
      logLiveEpg('cancelled', { reason: 'stale-or-suspended', channelId: channel.id });
      break;
    }

    const programs = await fetchProgramsForChannel(bundle, channel);
    if (generation !== epgGeneration) {
      logLiveEpg('cancelled', { reason: 'stale-after-fetch', channelId: channel.id });
      break;
    }
    epgMap.set(channel.id, programs);
    options?.onChannelEnriched?.(enrichChannelWithEpg(channel, programs));
  }

  return channels.map((channel) => {
    const programs = epgMap.get(channel.id);
    return programs ? enrichChannelWithEpg(channel, programs) : channel;
  });
}

export async function enrichSingleChannelEpg(
  bundle: ProviderRepositoryBundle,
  channel: ProviderLiveChannel,
): Promise<ProviderLiveChannel> {
  if (shouldSuspendLiveListEpg(getLiveTvWorkload()) && getLiveTvWorkload().surfTransitionInFlight) {
    logLiveEpg('cancelled', { reason: 'surf-priority', channelId: channel.id });
    return channel;
  }

  const cached = readCachedPrograms(channel.id);
  if (cached) {
    logLiveEpg('cache-hit', { channelId: channel.id, reason: 'focused' });
    return enrichChannelWithEpg(channel, cached);
  }

  const programs = await fetchProgramsForChannel(bundle, channel);
  return enrichChannelWithEpg(channel, programs);
}
