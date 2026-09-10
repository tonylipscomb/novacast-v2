import type { ProviderRepositoryBundle } from '../providers/providerBundle.ts';
import type { ProviderGuideProgram, ProviderLiveChannel } from '../providers/providerRepositories.ts';
import { displayStreamTitle } from '../series/metadata/titleNormalization.ts';
import { displayLiveProgramText } from './liveTvProgramText.ts';
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
export const EPG_CACHE_TTL_MS = 5 * 60 * 1000;
const LIVE_EPG_CLASSIFICATION_AUDIT = '[NovaCast Live EPG Classification Audit]';

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

function safeAuditText(value: unknown, maxLength = 160) {
  if (typeof value !== 'string') return null;
  return value
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/(?:password|passwd|token|secret|authorization|bearer|api[_ -]?key)\s*[=:]\s*[^\s,;]+/gi, '[redacted]')
    .trim()
    .slice(0, maxLength) || null;
}

function auditProgramRows(programs: ProviderGuideProgram[]) {
  return programs.slice(0, 3).map((program) => ({
    title: safeAuditText(program.title),
    startAt: program.startAt ?? null,
    endAt: program.endAt ?? null,
  }));
}

function logReturnedEpgPrograms(channel: ProviderLiveChannel, programs: ProviderGuideProgram[]) {
  console.info(LIVE_EPG_CLASSIFICATION_AUDIT, {
    event: 'programs-returned',
    channelId: channel.id,
    programCount: programs.length,
    programs: auditProgramRows(programs),
    now: Date.now(),
    hasTimedPrograms: programs.some((program) => program.startAt != null && program.endAt != null),
  });
}

function isTimedCurrent(program: ProviderGuideProgram, now: number) {
  return program.startAt != null && program.endAt != null && program.startAt <= now && program.endAt > now;
}

export function orderTimedEpgPrograms(programs: ProviderGuideProgram[], now = Date.now()) {
  const timed = programs.filter((program) => program.startAt != null && program.endAt != null);
  if (!timed.length) return programs;
  const current = timed.find((program) => isTimedCurrent(program, now));
  const future = timed
    .filter((program) => (program.startAt as number) > now)
    .sort((left, right) => (left.startAt as number) - (right.startAt as number));
  return current ? [current, ...future] : future;
}

export function enrichChannelWithEpg(channel: ProviderLiveChannel, programs: ProviderGuideProgram[]): ProviderLiveChannel {
  if (!programs.length) {
    const title = displayLiveProgramText(channel.current, '');
    const channelLabel = displayStreamTitle(channel.name);
    console.info(LIVE_EPG_CLASSIFICATION_AUDIT, {
      channelId: channel.id,
      programCount: 0,
      programs: [],
      now: Date.now(),
      hasTimedPrograms: false,
      orderedFirstProgramTitle: null,
      hasCurrent: false,
      resultingCurrentTitle: title && title !== channelLabel && title !== channel.name.trim() ? title : null,
      resultingNextTitle: safeAuditText(channel.next),
    });
    return {
      ...channel,
      current: title && title !== channelLabel && title !== channel.name.trim() ? title : '',
    };
  }

  const orderedPrograms = orderTimedEpgPrograms(programs);
  const hasTimedPrograms = programs.some((program) => program.startAt != null && program.endAt != null);
  const now = hasTimedPrograms ? orderedPrograms[0] : programs[0];
  const nowMs = Date.now();
  const hasCurrent = hasTimedPrograms && isTimedCurrent(now, nowMs);
  const next = hasTimedPrograms ? orderedPrograms[hasCurrent ? 1 : 0] : programs[1];
  const following = hasTimedPrograms ? orderedPrograms[hasCurrent ? 2 : 1] : programs[2];
  const programTitle = displayLiveProgramText(now.title, '');
  const channelLabel = displayStreamTitle(channel.name);
  const current = hasCurrent || !hasTimedPrograms;
  const resultingCurrentTitle = current && programTitle && programTitle !== channelLabel && programTitle !== channel.name.trim() ? programTitle : null;
  console.info(LIVE_EPG_CLASSIFICATION_AUDIT, {
    channelId: channel.id,
    programCount: programs.length,
    programs: auditProgramRows(programs),
    now: nowMs,
    hasTimedPrograms,
    orderedFirstProgramTitle: safeAuditText(now.title),
    hasCurrent,
    resultingCurrentTitle: safeAuditText(resultingCurrentTitle),
    resultingNextTitle: safeAuditText(next?.title ?? channel.next),
  });

  return {
    ...channel,
    current: resultingCurrentTitle ?? '',
    next: next?.title ? displayLiveProgramText(next.title, channel.next) : channel.next,
    following: following?.title ? displayLiveProgramText(following.title, channel.following) : channel.following,
    currentStart: current ? (now.start ?? channel.currentStart) : '',
    currentEnd: current ? (now.end ?? channel.currentEnd) : '',
    remaining: current && now.meta.includes('left') ? now.meta : '',
    progress: current ? epgProgressFromProgram(now) : 0,
    description: current ? displayLiveProgramText(now.description, 'No program information available.') : 'No program information available.',
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
      logReturnedEpgPrograms(channel, programs);
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
