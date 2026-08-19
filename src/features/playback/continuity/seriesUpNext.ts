import { isNovaCastTraceLoggingEnabled } from '../../diagnostics/novacastLogPolicy.ts';
import {
  clampSeekPosition,
  formatSeasonEpisode,
  getNextEpisode,
  getPreviousEpisode,
  isPlaybackNaturallyFinished,
  isResumeEligible,
  parseEpisodeIndex,
  sortEpisodesByNumber,
  UP_NEXT_COUNTDOWN_SECONDS,
  UP_NEXT_REMAINING_MS,
} from './playbackContinuity.ts';

export type SeriesUpNextEvent =
  | 'candidate-resolved'
  | 'armed'
  | 'countdown-started'
  | 'countdown-tick'
  | 'play-now'
  | 'cancelled'
  | 'auto-triggered'
  | 'transition-start'
  | 'current-completion-saved'
  | 'next-source-resolved'
  | 'next-session-created'
  | 'next-player-ready'
  | 'transition-failed'
  | 'no-next-episode';

export type SeriesUpNextLogFields = {
  event: SeriesUpNextEvent;
  seriesId?: string | null;
  currentEpisodeId?: string | null;
  currentSeasonNumber?: string | null;
  currentEpisodeNumber?: string | null;
  nextEpisodeId?: string | null;
  nextSeasonNumber?: string | null;
  nextEpisodeNumber?: string | null;
  remainingSeconds?: number | null;
  triggerReason?: string | null;
  sessionId?: string | null;
  transitionId?: string | null;
};

export type SeriesAutoplayEvent =
  | 'completion-detected'
  | 'next-episode-resolved'
  | 'countdown-shown'
  | 'countdown-tick'
  | 'play-now'
  | 'cancelled'
  | 'autoplay-start'
  | 'autoplay-complete'
  | 'no-next-episode'
  | 'source-failed';

export type SeriesAutoplayLogFields = {
  event: SeriesAutoplayEvent;
  seriesIdPresent: boolean;
  seasonNumber?: string | number | null;
  episodeNumber?: string | number | null;
  nextSeasonNumber?: string | number | null;
  nextEpisodeNumber?: string | number | null;
  countdownSeconds?: number | null;
};

export type SeriesAutoplayDecision =
  | { action: 'none' }
  | { action: 'arm' }
  | { action: 'autoplay' }
  | { action: 'close'; reason: 'no-next-episode' | 'cancelled' | 'autoplay-disabled' };

export function remainingPlaybackMs(positionMs: number, durationMs: number): number {
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(0, durationMs - clampSeekPosition(positionMs, durationMs));
}

export function shouldArmSeriesUpNext(input: {
  mediaType?: string | null;
  remainingMs: number;
  durationMs: number;
  nextEpisodePresent: boolean;
  alreadyArmed: boolean;
  dismissedForSession: boolean;
  seekPreviewActive?: boolean;
}): boolean {
  if (input.seekPreviewActive) {
    return false;
  }
  if (input.mediaType !== 'episode') {
    return false;
  }
  if (input.alreadyArmed || input.dismissedForSession) {
    return false;
  }
  if (!input.nextEpisodePresent) {
    return false;
  }
  if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
    return false;
  }
  return input.remainingMs <= UP_NEXT_REMAINING_MS;
}

export function shouldResetSeriesUpNextAfterCommittedSeek(input: {
  mediaType?: string | null;
  remainingMs: number;
  upNextVisible: boolean;
  alreadyArmed: boolean;
}): boolean {
  if (input.mediaType !== 'episode') {
    return false;
  }
  if (!Number.isFinite(input.remainingMs) || input.remainingMs <= UP_NEXT_REMAINING_MS) {
    return false;
  }
  return input.upNextVisible || input.alreadyArmed;
}

export function shouldCloseSeriesEpisodeWithoutUpNext(input: {
  nextEpisodePresent: boolean;
  dismissedForSession: boolean;
  naturallyFinished: boolean;
  upNextVisible: boolean;
  autoplayEnabled?: boolean;
}): boolean {
  if (!input.naturallyFinished) {
    return false;
  }
  if (input.upNextVisible) {
    return input.autoplayEnabled === false;
  }
  return !input.nextEpisodePresent || input.dismissedForSession;
}

export function shouldCommitSeriesUpNextTransition(input: {
  transitionId: string | null;
  committedTransitionId: string | null;
  nextStreamUrlPresent: boolean;
}): boolean {
  if (!input.transitionId || input.committedTransitionId === input.transitionId) {
    return false;
  }
  return input.nextStreamUrlPresent;
}

export function createSeriesUpNextTransitionId(episodeId: string, sessionId: string): string {
  return `${sessionId}:${episodeId}:up-next`;
}

export function isSeriesEpisodePlayable(episode: {
  id?: string;
  streamId?: string;
  streamUrl?: string;
}): boolean {
  if (episode.id !== undefined && String(episode.id).trim() === '') {
    return false;
  }
  if (episode.streamId !== undefined && String(episode.streamId).trim() === '') {
    return false;
  }
  if (episode.streamUrl !== undefined && String(episode.streamUrl).trim() === '') {
    return false;
  }
  return true;
}

export function getSeriesAutoplayQueue<T extends { id?: string; streamUrl?: string }>(item: {
  nextEpisode?: T | null;
  upcomingEpisodes?: T[] | null;
}): T[] {
  if (item.upcomingEpisodes?.length) {
    return item.upcomingEpisodes;
  }
  return item.nextEpisode ? [item.nextEpisode] : [];
}

export function pickPlayableNextEpisode<T extends { streamUrl?: string }>(
  queue: T[],
): { next: T | null; remaining: T[] } {
  const index = queue.findIndex((episode) => Boolean(episode.streamUrl?.trim()));
  if (index < 0) {
    return { next: null, remaining: [] };
  }
  return {
    next: queue[index] ?? null,
    remaining: queue.slice(index + 1),
  };
}

export function shouldTreatPlayerStatusAsSeriesEpisodeEnd(input: {
  mediaType?: string | null;
  status?: string | null;
  machineState?: string | null;
  livePositionMs: number;
  liveDurationMs: number;
  lastPlayingPositionMs: number;
  transitionInFlight?: boolean;
}): boolean {
  if (input.mediaType !== 'episode') {
    return false;
  }
  if (input.transitionInFlight) {
    return false;
  }
  if (input.status !== 'idle') {
    return false;
  }
  if (
    input.machineState !== 'playing' &&
    input.machineState !== 'paused' &&
    input.machineState !== 'ready'
  ) {
    return false;
  }

  const liveFinished = isPlaybackNaturallyFinished(input.livePositionMs, input.liveDurationMs);
  const lastFinished = isPlaybackNaturallyFinished(input.lastPlayingPositionMs, input.liveDurationMs);
  const lastRemaining = remainingPlaybackMs(input.lastPlayingPositionMs, input.liveDurationMs);
  const resetAfterNearEnd =
    input.livePositionMs <= 1250 && lastRemaining <= UP_NEXT_REMAINING_MS + 2000;
  return liveFinished || lastFinished || resetAfterNearEnd;
}

export function shouldStartSeriesAutoplayOnNaturalEnd(input: {
  mediaType?: string | null;
  nextEpisodePresent: boolean;
  dismissedForSession: boolean;
  autoplayEnabled: boolean;
  naturallyFinished: boolean;
  alreadyCommitted?: boolean;
}): boolean {
  if (input.mediaType !== 'episode') {
    return false;
  }
  if (!input.naturallyFinished || input.alreadyCommitted || input.dismissedForSession) {
    return false;
  }
  return input.nextEpisodePresent && input.autoplayEnabled !== false;
}

export function resolveSeriesAutoplayDecision(input: {
  mediaType?: string | null;
  remainingMs: number;
  durationMs: number;
  positionMs: number;
  nextEpisodePresent: boolean;
  alreadyArmed: boolean;
  dismissedForSession: boolean;
  seekPreviewActive?: boolean;
  autoplayEnabled: boolean;
  transitionInFlight?: boolean;
  machineState?: string | null;
  playerStatus?: string | null;
  lastPlayingPositionMs?: number;
}): SeriesAutoplayDecision {
  if (input.mediaType !== 'episode') {
    return { action: 'none' };
  }
  if (input.transitionInFlight) {
    return { action: 'none' };
  }
  if (input.machineState === 'error' || input.machineState === 'closing' || input.playerStatus === 'error') {
    return { action: 'none' };
  }

  const naturallyFinished =
    isPlaybackNaturallyFinished(input.positionMs, input.durationMs) ||
    shouldTreatPlayerStatusAsSeriesEpisodeEnd({
      mediaType: input.mediaType,
      status: input.playerStatus,
      machineState: input.machineState,
      livePositionMs: input.positionMs,
      liveDurationMs: input.durationMs,
      lastPlayingPositionMs: input.lastPlayingPositionMs ?? input.positionMs,
      transitionInFlight: input.transitionInFlight,
    });

  if (
    shouldStartSeriesAutoplayOnNaturalEnd({
      mediaType: input.mediaType,
      nextEpisodePresent: input.nextEpisodePresent,
      dismissedForSession: input.dismissedForSession,
      autoplayEnabled: input.autoplayEnabled,
      naturallyFinished,
    })
  ) {
    // Keep the visible countdown in charge while the current episode is still
    // playing. Only skip ahead when native playback has already ended.
    if (input.alreadyArmed && input.playerStatus !== 'idle') {
      return { action: 'none' };
    }
    return { action: 'autoplay' };
  }

  if (
    shouldArmSeriesUpNext({
      mediaType: input.mediaType,
      remainingMs: input.remainingMs,
      durationMs: input.durationMs,
      nextEpisodePresent: input.nextEpisodePresent,
      alreadyArmed: input.alreadyArmed,
      dismissedForSession: input.dismissedForSession,
      seekPreviewActive: input.seekPreviewActive,
    })
  ) {
    return { action: 'arm' };
  }

  if (
    shouldCloseSeriesEpisodeWithoutUpNext({
      nextEpisodePresent: input.nextEpisodePresent,
      dismissedForSession: input.dismissedForSession,
      naturallyFinished,
      upNextVisible: input.alreadyArmed && !input.dismissedForSession,
      autoplayEnabled: input.autoplayEnabled,
    })
  ) {
    const reason = !input.nextEpisodePresent
      ? 'no-next-episode'
      : input.dismissedForSession
        ? 'cancelled'
        : 'autoplay-disabled';
    return { action: 'close', reason };
  }

  return { action: 'none' };
}

export function resolveSeriesUpNextEpisode<T extends { id?: string; seasonNumber: string; episodeNumber: string; streamId?: string; streamUrl?: string }>(
  episodes: T[],
  current: { seasonNumber: string; episodeNumber: string; id?: string },
): T | null {
  const currentSeason = parseEpisodeIndex(current.seasonNumber);
  const currentEpisode = parseEpisodeIndex(current.episodeNumber);
  if (currentSeason == null || currentEpisode == null) {
    return null;
  }

  return getNextEpisode(eligibleSeriesEpisodes(episodes, current), current);
}

function eligibleSeriesEpisodes<T extends { id?: string; seasonNumber: string; episodeNumber: string; streamId?: string; streamUrl?: string }>(
  episodes: T[],
  current: { seasonNumber: string; episodeNumber: string; id?: string },
): T[] {
  const currentSeason = parseEpisodeIndex(current.seasonNumber);
  const includeSpecials = currentSeason === 0;
  const seen = new Set<string>();
  const eligible: T[] = [];
  for (const episode of episodes) {
    const season = parseEpisodeIndex(episode.seasonNumber);
    const number = parseEpisodeIndex(episode.episodeNumber);
    if (season == null || number == null) {
      continue;
    }
    if (season === 0 && !includeSpecials) {
      continue;
    }
    if (!isSeriesEpisodePlayable(episode)) {
      continue;
    }
    const key = `${season}:${number}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    eligible.push(episode);
  }
  return eligible;
}

export function resolveSeriesPreviousEpisode<T extends { id?: string; seasonNumber: string; episodeNumber: string }>(
  episodes: T[],
  current: { seasonNumber: string; episodeNumber: string; id?: string },
): T | null {
  const currentSeason = parseEpisodeIndex(current.seasonNumber);
  const currentEpisode = parseEpisodeIndex(current.episodeNumber);
  if (currentSeason == null || currentEpisode == null) {
    return null;
  }

  return getPreviousEpisode(eligibleSeriesEpisodes(episodes, current), current);
}

export function sliceSeriesUpNextEpisodes<T extends { id?: string; seasonNumber: string; episodeNumber: string }>(
  episodes: T[],
  current: { seasonNumber: string; episodeNumber: string; id?: string },
  limit = 40,
): T[] {
  const upcoming: T[] = [];
  const seen = new Set<string>();
  let cursor = current;
  while (upcoming.length < limit) {
    const next = resolveSeriesUpNextEpisode(episodes, cursor);
    if (!next) {
      break;
    }
    const key = `${next.seasonNumber}:${next.episodeNumber}`;
    if (seen.has(key)) {
      break;
    }
    seen.add(key);
    upcoming.push(next);
    cursor = next;
  }
  return upcoming;
}

export function sliceSeriesPreviousEpisodes<T extends { id?: string; seasonNumber: string; episodeNumber: string }>(
  episodes: T[],
  current: { seasonNumber: string; episodeNumber: string; id?: string },
  limit = 40,
): T[] {
  const previous: T[] = [];
  const seen = new Set<string>();
  let cursor = current;
  while (previous.length < limit) {
    const prior = resolveSeriesPreviousEpisode(episodes, cursor);
    if (!prior) {
      break;
    }
    const key = `${prior.seasonNumber}:${prior.episodeNumber}`;
    if (seen.has(key)) {
      break;
    }
    seen.add(key);
    previous.push(prior);
    cursor = prior;
  }
  return previous;
}

export function logSeriesUpNext(fields: SeriesUpNextLogFields) {
  if (fields.event === 'countdown-tick' && !isNovaCastTraceLoggingEnabled()) {
    return;
  }
  console.info(
    '[NovaCast Series Up Next] ' +
      JSON.stringify({
        event: fields.event,
        seriesId: fields.seriesId ?? null,
        currentEpisodeId: fields.currentEpisodeId ?? null,
        currentSeasonNumber: fields.currentSeasonNumber ?? null,
        currentEpisodeNumber: fields.currentEpisodeNumber ?? null,
        nextEpisodeId: fields.nextEpisodeId ?? null,
        nextSeasonNumber: fields.nextSeasonNumber ?? null,
        nextEpisodeNumber: fields.nextEpisodeNumber ?? null,
        remainingSeconds: fields.remainingSeconds ?? null,
        triggerReason: fields.triggerReason ?? null,
        sessionId: fields.sessionId ?? null,
        transitionId: fields.transitionId ?? null,
        countdownSeconds: UP_NEXT_COUNTDOWN_SECONDS,
      }),
  );
}

export function logSeriesAutoplay(fields: SeriesAutoplayLogFields) {
  if (fields.event === 'countdown-tick' && !isNovaCastTraceLoggingEnabled()) {
    return;
  }
  console.info(
    '[NovaCast Series Autoplay] ' +
      JSON.stringify({
        event: fields.event,
        seriesIdPresent: fields.seriesIdPresent,
        seasonNumber: fields.seasonNumber ?? undefined,
        episodeNumber: fields.episodeNumber ?? undefined,
        nextSeasonNumber: fields.nextSeasonNumber ?? undefined,
        nextEpisodeNumber: fields.nextEpisodeNumber ?? undefined,
        countdownSeconds: fields.countdownSeconds ?? undefined,
      }),
  );
}

export type SeriesContinuePlayMode = 'continue' | 'play-next' | 'play';

export type SeriesContinueWatchingPointer = {
  episodeId?: string;
  seasonNumber?: string;
  episodeNumber?: string;
  positionMs: number;
  durationMs: number;
};

export function resolveSeriesContinuePlayTarget<T extends { id: string; seasonNumber: string; episodeNumber: string }>(input: {
  episodes: T[];
  continueWatching?: SeriesContinueWatchingPointer | null;
}): { episode: T | null; mode: SeriesContinuePlayMode } {
  const episodes = input.episodes;
  if (!episodes.length) {
    return { episode: null, mode: 'play' };
  }

  const cw = input.continueWatching;
  if (!cw) {
    return { episode: sortEpisodesByNumber(episodes)[0] ?? null, mode: 'play' };
  }

  const current =
    (cw.episodeId ? episodes.find((item) => item.id === cw.episodeId) : undefined) ??
    episodes.find((item) => item.seasonNumber === cw.seasonNumber && item.episodeNumber === cw.episodeNumber) ??
    null;

  if (current && isResumeEligible(cw.positionMs, cw.durationMs)) {
    return { episode: current, mode: 'continue' };
  }

  const cursor = current ?? {
    seasonNumber: cw.seasonNumber ?? '1',
    episodeNumber: cw.episodeNumber ?? '1',
  };
  const next = resolveSeriesUpNextEpisode(episodes, cursor);
  if (next) {
    return { episode: next, mode: 'play-next' };
  }

  return { episode: sortEpisodesByNumber(episodes)[0] ?? null, mode: 'play' };
}

export function formatSeriesContinuePlayLabel(input: {
  mode: SeriesContinuePlayMode;
  episode: { seasonNumber: string; episodeNumber: string } | null;
}): string {
  if (!input.episode || input.mode === 'play') {
    return 'Play';
  }
  const label = formatSeasonEpisode(input.episode.seasonNumber, input.episode.episodeNumber);
  if (!label) {
    return input.mode === 'continue' ? 'Continue' : 'Play';
  }
  return input.mode === 'continue' ? `Continue ${label}` : `Play ${label}`;
}
