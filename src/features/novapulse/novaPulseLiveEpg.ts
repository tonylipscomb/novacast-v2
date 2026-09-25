import type { ProviderGuideProgram, ProviderLiveChannel } from '../providers/providerRepositories.ts';
import { getLiveChannelIndexEntry } from '../search/liveChannelIndex.ts';
import type { HomeFavoriteChannel } from '../personalization/personalizationHome.ts';
import type { RecentItemRecord } from '../personalization/personalizationModel.ts';
import { isNovaPulseEnglishDescription } from './novaPulseLogic.ts';
import type { NovaPulseItem } from './novaPulseTypes.ts';
import { normalizeGuideProgram, type NormalizedGuideProgram } from '../guide/guideTimeline.ts';
import { curateNovaPulseLiveCategory } from './novaPulseCuration.ts';

export const NOVA_PULSE_LIVE_CANDIDATE_LIMIT = 6;
export const NOVA_PULSE_LIVE_EPG_LIMIT = 3;
export const NOVA_PULSE_LIVE_EPG_CONCURRENCY = 2;
export const NOVA_PULSE_LIVE_EPG_TTL_MS = 5 * 60 * 1000;
export const NOVA_PULSE_LIVE_EPG_CARD_LIMIT = 2;
const NOVA_PULSE_UP_NEXT_HORIZON_MS = 2 * 60 * 60 * 1000;
const NOVA_PULSE_EPG_CACHE_VERSION = 'normalized-v2';

export type NovaPulseLiveChannelReason = 'favorite_channel' | 'recent_channel';
export type NovaPulseLiveTimingReason = 'on_now' | 'up_next' | 'tonight';

export type NovaPulseLiveEpgDiagnostics = {
  favoriteChannels: number;
  recentChannels: number;
  candidateChannels: number;
  resolvedChannels: number;
  epgRequestsStarted: number;
  epgCacheHits: number;
  epgFailures: number;
  onNowCandidates: number;
  upNextCandidates: number;
  tonightCandidates: number;
  epgCardsSelected: number;
  favoriteCardsSelected: number;
  recentCardsSelected: number;
  nonEnglishProgramsRejected: number;
  nonEnglishDescriptionsOmitted: number;
  epgRowsReturned: number;
  epgRowsNormalized: number;
  managedEpgHits: number;
  providerEpgHits: number;
  emptyEpgResponses: number;
  rowsWithStartAt: number;
  rowsWithEndAt: number;
  rowsWithStartString: number;
  rowsWithEndString: number;
  invalidTimestampRows: number;
  expiredRowsRejected: number;
  futureRowsSeen: number;
  currentRowsSeen: number;
  titleRejectedRows: number;
  languageRejectedRows: number;
  classificationRejectedRows: number;
  directTuneCards: number;
  liveIndexSize: number;
  resolvedFromIndex: number;
  resolvedFromPersonalization: number;
  resolutionMisses: number;
  providerMismatches: number;
  indexNotReady: number;
  adultRejected: number;
  regionForeignRejected: number;
};

export type NovaPulseLiveEpgResult = {
  items: NovaPulseItem[];
  diagnostics: NovaPulseLiveEpgDiagnostics;
};

type Candidate = {
  channel: ProviderLiveChannel;
  channelReason: NovaPulseLiveChannelReason;
  recentAt: number;
  favorite: boolean;
  priorityRank: number;
  resolvedFromIndex: boolean;
};

function channelFromIndexEntry(entry: NonNullable<ReturnType<typeof getLiveChannelIndexEntry>>): ProviderLiveChannel {
  return {
    id: entry.id,
    categoryId: entry.categoryId,
    categoryName: entry.categoryName,
    number: entry.number,
    name: entry.name,
    shortName: entry.name.slice(0, 2) || 'TV',
    current: entry.current ?? '',
    next: '',
    following: '',
    description: '',
    resolution: '',
    audio: '',
    remaining: '',
    progress: 0,
    tone: entry.tone ?? '#173B67',
    currentStart: '',
    currentEnd: '',
    logoUrl: entry.logoUrl,
    containerExtension: entry.containerExtension,
    streamUrl: entry.streamUrl,
  };
}

function normalizeLiveIdentity(value: unknown) {
  const raw = String(value ?? '').trim();
  return raw.startsWith('live:') ? raw.slice('live:'.length).trim() : raw;
}

function partialChannelFromPersonalization(input: {
  id: string;
  title: string;
  artworkUrl?: string;
  categoryId?: string;
  containerExtension?: string;
  epgChannelId?: string;
}): ProviderLiveChannel {
  return {
    id: input.id,
    categoryId: input.categoryId ?? '',
    number: 0,
    name: input.title || input.id,
    shortName: (input.title || input.id).slice(0, 2) || 'TV',
    current: '', next: '', following: '', description: '', resolution: '', audio: '', remaining: '', progress: 0,
    tone: '#173B67', currentStart: '', currentEnd: '', logoUrl: input.artworkUrl,
    epgChannelId: input.epgChannelId, containerExtension: input.containerExtension,
  };
}

type CachedPrograms = { programs: NormalizedGuideProgram[]; cachedAt: number };
const cache = new Map<string, CachedPrograms>();
const inFlight = new Map<string, Promise<NormalizedGuideProgram[]>>();

function cacheKey(providerId: string, channelId: string) {
  return `${NOVA_PULSE_EPG_CACHE_VERSION}::${providerId}::${channelId}`;
}

function readCached(providerId: string, channelId: string) {
  const value = cache.get(cacheKey(providerId, channelId));
  if (!value) return null;
  if (Date.now() - value.cachedAt > NOVA_PULSE_LIVE_EPG_TTL_MS) {
    cache.delete(cacheKey(providerId, channelId));
    return null;
  }
  return value.programs;
}

function buildCandidates(input: {
  providerId: string;
  favoriteChannels: readonly HomeFavoriteChannel[];
  recentItems: readonly RecentItemRecord[];
  getIndexEntry: (channelId: string) => ReturnType<typeof getLiveChannelIndexEntry>;
  contentPolicy?: import('../content-policy/ContentPolicyService.ts').ContentPolicyId;
}) {
  let providerMismatches = 0;
  const favorites = new Map<string, HomeFavoriteChannel>();
  for (const item of input.favoriteChannels) {
    if (item.providerId && item.providerId !== input.providerId) {
      providerMismatches += 1;
      continue;
    }
    const id = normalizeLiveIdentity(item.streamId || item.id);
    if (id) favorites.set(id, item);
  }
  const recents = input.recentItems.filter((item) => {
    if (item.mediaType !== 'live') return false;
    if (item.providerId !== input.providerId) {
      providerMismatches += 1;
      return false;
    }
    return true;
  });
  const recentById = new Map<string, RecentItemRecord>();
  for (const item of recents) {
    const id = normalizeLiveIdentity(item.streamId || item.contentId);
    if (id) recentById.set(id, item);
  }
  const ids = [...new Set([...favorites.keys(), ...recentById.keys()])];
  const candidates: Candidate[] = [];
  let adultRejected = 0;
  let regionForeignRejected = 0;
  let resolvedFromIndex = 0;
  let resolvedFromPersonalization = 0;
  let resolutionMisses = 0;
  for (const id of ids) {
    const favorite = favorites.get(id);
    const recent = recentById.get(id);
    const entry = input.getIndexEntry(id) ?? input.getIndexEntry(`live:${id}`);
    const channel = entry
      ? channelFromIndexEntry(entry)
      : favorite || recent
        ? partialChannelFromPersonalization({
            id,
            title: favorite?.title ?? recent?.title ?? id,
            artworkUrl: favorite?.artworkUrl ?? recent?.artworkUrl,
            categoryId: favorite?.categoryId ?? recent?.categoryId,
            containerExtension: favorite?.containerExtension ?? recent?.containerExtension,
            epgChannelId: recent?.epgChannelId,
          })
        : null;
    if (!channel) {
      resolutionMisses += 1;
      continue;
    }
    const curation = curateNovaPulseLiveCategory({ categoryName: channel.categoryName, contentPolicy: input.contentPolicy });
    if (!curation.allowed) {
      if (curation.adult) adultRejected += 1;
      if (curation.reason === 'foreign-region') regionForeignRejected += 1;
      continue;
    }
    if (entry) resolvedFromIndex += 1;
    else resolvedFromPersonalization += 1;
    candidates.push({
      channel,
      channelReason: favorite ? 'favorite_channel' : 'recent_channel',
      recentAt: recent?.lastOpenedAt ?? 0,
      favorite: Boolean(favorite),
      priorityRank: favorite && recent ? 2 : favorite ? 1 : 0,
      resolvedFromIndex: Boolean(entry),
    });
  }
  return {
    candidates: candidates
      .sort((left, right) => right.priorityRank - left.priorityRank || right.recentAt - left.recentAt || left.channel.id.localeCompare(right.channel.id))
      .slice(0, NOVA_PULSE_LIVE_CANDIDATE_LIMIT),
    resolution: { resolvedFromIndex, resolvedFromPersonalization, resolutionMisses, providerMismatches },
    curation: { adultRejected, regionForeignRejected },
  };
}

function isTimed(program: ProviderGuideProgram): program is ProviderGuideProgram & { startAt: number; endAt: number } {
  return Number.isFinite(program.startAt) && Number.isFinite(program.endAt) && (program.endAt as number) > (program.startAt as number);
}

function localEndOfDay(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
}

function chooseProgram(programs: readonly ProviderGuideProgram[], nowMs: number) {
  const timed = programs.filter(isTimed).sort((left, right) => left.startAt - right.startAt);
  const current = timed.find((program) => program.startAt <= nowMs && nowMs < program.endAt);
  if (current) return { program: current, timingReason: 'on_now' as const };
  const future = timed.filter((program) => program.startAt > nowMs);
  const upcoming = future[0];
  if (upcoming && upcoming.startAt <= nowMs + NOVA_PULSE_UP_NEXT_HORIZON_MS) {
    return { program: upcoming, timingReason: 'up_next' as const };
  }
  const tonight = future.find((program) => program.startAt < localEndOfDay(new Date(nowMs)));
  return tonight ? { program: tonight, timingReason: 'tonight' as const } : null;
}

function auditPrograms(
  programs: readonly ProviderGuideProgram[],
  diagnostics: NovaPulseLiveEpgDiagnostics,
  nowMs: number,
): NormalizedGuideProgram[] {
  if (!programs.length) diagnostics.emptyEpgResponses += 1;
  const normalized = programs.map((program, index) => {
    if (program.startAt !== undefined) diagnostics.rowsWithStartAt += 1;
    if (program.endAt !== undefined) diagnostics.rowsWithEndAt += 1;
    if (typeof program.start === 'string' && program.start.trim()) diagnostics.rowsWithStartString += 1;
    if (typeof program.end === 'string' && program.end.trim()) diagnostics.rowsWithEndString += 1;
    if (!program.title?.trim()) diagnostics.titleRejectedRows += 1;
    if (program.epgSource === 'managed') diagnostics.managedEpgHits += 1;
    if (program.epgSource === 'provider') diagnostics.providerEpgHits += 1;
    const value = normalizeGuideProgram(program, index, nowMs);
    if (!value.hasValidWindow || value.startAt === undefined || value.endAt === undefined) {
      diagnostics.invalidTimestampRows += 1;
      return value;
    }
    if (value.endAt <= nowMs) diagnostics.expiredRowsRejected += 1;
    else if (value.startAt > nowMs) diagnostics.futureRowsSeen += 1;
    else diagnostics.currentRowsSeen += 1;
    return value;
  });
  diagnostics.epgRowsNormalized += normalized.filter((program) => program.hasValidWindow).length;
  return normalized;
}

function formatProgramTime(program: ProviderGuideProgram) {
  const format = (value?: number) => value == null ? '' : new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
  return [format(program.startAt), format(program.endAt)].filter(Boolean).join('–');
}

function formatRelativeTime(targetMs: number, nowMs: number) {
  const minutes = Math.max(1, Math.round((targetMs - nowMs) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

async function bounded<T>(items: readonly T[], concurrency: number, task: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) await task(items[next++]);
  }));
}

export async function runNovaPulseLiveEpgCycle(input: {
  providerId: string;
  favoriteChannels: readonly HomeFavoriteChannel[];
  recentItems: readonly RecentItemRecord[];
  getIndexEntry?: (channelId: string) => ReturnType<typeof getLiveChannelIndexEntry>;
  getIndexSize?: () => number;
  getShortEpg?: (channelId: string, limit?: number, signal?: AbortSignal, epgChannelId?: string) => Promise<ProviderGuideProgram[]>;
  contentPolicy?: import('../content-policy/ContentPolicyService.ts').ContentPolicyId;
  isCurrent?: () => boolean;
  nowMs?: number;
}): Promise<NovaPulseLiveEpgResult> {
  const candidateResult = buildCandidates({
    providerId: input.providerId,
    favoriteChannels: input.favoriteChannels,
    recentItems: input.recentItems,
    getIndexEntry: input.getIndexEntry ?? ((channelId) => getLiveChannelIndexEntry(input.providerId, channelId)),
    contentPolicy: input.contentPolicy,
  });
  const candidates = candidateResult.candidates;
  const liveIndexSize = input.getIndexSize?.() ?? 0;
  const diagnostics: NovaPulseLiveEpgDiagnostics = {
    favoriteChannels: input.favoriteChannels.length,
    recentChannels: input.recentItems.filter((item) => item.mediaType === 'live').length,
    candidateChannels: candidates.length,
    resolvedChannels: candidates.length,
    epgRequestsStarted: 0,
    epgCacheHits: 0,
    epgFailures: 0,
    onNowCandidates: 0,
    upNextCandidates: 0,
    tonightCandidates: 0,
    epgCardsSelected: 0,
    favoriteCardsSelected: 0,
    recentCardsSelected: 0,
    nonEnglishProgramsRejected: 0,
    nonEnglishDescriptionsOmitted: 0,
    epgRowsReturned: 0,
    epgRowsNormalized: 0,
    managedEpgHits: 0,
    providerEpgHits: 0,
    emptyEpgResponses: 0,
    rowsWithStartAt: 0,
    rowsWithEndAt: 0,
    rowsWithStartString: 0,
    rowsWithEndString: 0,
    invalidTimestampRows: 0,
    expiredRowsRejected: 0,
    futureRowsSeen: 0,
    currentRowsSeen: 0,
    titleRejectedRows: 0,
    languageRejectedRows: 0,
    classificationRejectedRows: 0,
    directTuneCards: 0,
    liveIndexSize,
    resolvedFromIndex: candidates.filter((candidate) => candidate.resolvedFromIndex).length,
    resolvedFromPersonalization: candidates.filter((candidate) => !candidate.resolvedFromIndex).length,
    resolutionMisses: candidateResult.resolution.resolutionMisses,
    providerMismatches: candidateResult.resolution.providerMismatches,
    indexNotReady: liveIndexSize === 0 ? 1 : 0,
    adultRejected: candidateResult.curation.adultRejected,
    regionForeignRejected: candidateResult.curation.regionForeignRejected,
  };
  if (!input.getShortEpg || !candidates.length) return { items: [], diagnostics };
  const nowMs = input.nowMs ?? Date.now();
  const resolved = new Map<string, ProviderGuideProgram[]>();
  await bounded(candidates, NOVA_PULSE_LIVE_EPG_CONCURRENCY, async (candidate) => {
    const cached = readCached(input.providerId, candidate.channel.id);
    if (cached) {
      diagnostics.epgCacheHits += 1;
      const audited = auditPrograms(cached, diagnostics, nowMs);
      resolved.set(candidate.channel.id, audited);
      return;
    }
    const key = cacheKey(input.providerId, candidate.channel.id);
    let request = inFlight.get(key);
    if (!request) {
      diagnostics.epgRequestsStarted += 1;
      request = input.getShortEpg!(candidate.channel.id, NOVA_PULSE_LIVE_EPG_LIMIT, undefined, candidate.channel.epgChannelId)
        .then((programs) => {
          diagnostics.epgRowsReturned += programs.length;
          const audited = auditPrograms(programs.slice(0, NOVA_PULSE_LIVE_EPG_LIMIT), diagnostics, nowMs);
          cache.set(key, { programs: audited, cachedAt: Date.now() });
          return audited;
        })
        .catch(() => {
          diagnostics.epgFailures += 1;
          cache.set(key, { programs: [], cachedAt: Date.now() });
          return [];
        })
        .finally(() => { if (inFlight.get(key) === request) inFlight.delete(key); });
      inFlight.set(key, request);
    } else {
      diagnostics.epgCacheHits += 1;
    }
    const programs = await request;
    if (input.isCurrent?.() === false) return;
    resolved.set(candidate.channel.id, programs);
  });
  if (input.isCurrent?.() === false) return { items: [], diagnostics };

  const items: NovaPulseItem[] = [];
  for (const candidate of candidates) {
    if (items.length >= NOVA_PULSE_LIVE_EPG_CARD_LIMIT) break;
    const candidatePrograms = resolved.get(candidate.channel.id) ?? [];
    const chosen = chooseProgram(candidatePrograms, nowMs);
    const validCandidates = candidatePrograms.filter((program) => isTimed(program) && program.endAt > nowMs);
    diagnostics.classificationRejectedRows += Math.max(0, validCandidates.length - (chosen ? 1 : 0));
    if (!chosen) continue;
    const program = chosen.program;
    if (!isNovaPulseEnglishDescription(program.title)) {
      diagnostics.nonEnglishProgramsRejected += 1;
      diagnostics.languageRejectedRows += 1;
      continue;
    }
    const description = program.description?.trim();
    const acceptableDescription = description && isNovaPulseEnglishDescription(description) ? description : undefined;
    if (description && !acceptableDescription) diagnostics.nonEnglishDescriptionsOmitted += 1;
    if (chosen.timingReason === 'on_now') diagnostics.onNowCandidates += 1;
    else if (chosen.timingReason === 'up_next') diagnostics.upNextCandidates += 1;
    else diagnostics.tonightCandidates += 1;
    const channelReason = candidate.channelReason;
    const isNow = chosen.timingReason === 'on_now';
    items.push({
      id: `live-epg:${input.providerId}:${candidate.channel.id}:${program.id}:${program.startAt ?? ''}`,
      type: 'live_epg',
      subtype: isNow ? 'live' : 'upcoming',
      badge: chosen.timingReason === 'on_now' ? 'ON NOW' : chosen.timingReason === 'up_next' ? 'UP NEXT' : 'TONIGHT',
      title: program.title.trim(),
      subtitle: [candidate.channel.name, formatProgramTime(program)].filter(Boolean).join(' • '),
      description: acceptableDescription,
      secondaryText: isNow && isTimed(program) ? `Ends in ${formatRelativeTime(program.endAt, nowMs)}` : chosen.timingReason === 'up_next' && isTimed(program) ? `Starts in ${formatRelativeTime(program.startAt, nowMs)}` : formatProgramTime(program),
      artworkUrl: candidate.channel.logoUrl,
      artworkFit: 'contain',
      artworkKind: candidate.channel.logoUrl ? 'channel_logo' : 'fallback',
      priority: (candidate.favorite ? 10 : 0) + (chosen.timingReason === 'on_now' ? 84 : chosen.timingReason === 'up_next' ? 76 : 68),
      sourceId: 'live-epg',
      sourceItemId: candidate.channel.id,
      channelId: candidate.channel.id,
      channelCategoryId: candidate.channel.categoryId,
      channelCategoryName: candidate.channel.categoryName,
      channelName: candidate.channel.name,
      channelLogoUrl: candidate.channel.logoUrl,
      programTitle: program.title,
      programDescription: acceptableDescription,
      programStartAt: program.startAt,
      programEndAt: program.endAt,
      timingReason: chosen.timingReason,
      channelReason,
      progress: isNow && isTimed(program) ? Math.max(0, Math.min(1, (nowMs - program.startAt) / (program.endAt - program.startAt))) : undefined,
      action: { type: 'channel', target: '/live', contentId: candidate.channel.id },
    });
    diagnostics.epgCardsSelected += 1;
    if (candidate.favorite) diagnostics.favoriteCardsSelected += 1;
    else diagnostics.recentCardsSelected += 1;
    diagnostics.directTuneCards += 1;
  }
  return { items, diagnostics };
}

export function resetNovaPulseLiveEpgCache() {
  cache.clear();
  inFlight.clear();
}
