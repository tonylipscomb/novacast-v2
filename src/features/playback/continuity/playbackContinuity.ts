/**
 * Shared playback-continuity helpers.
 * Home, Movies, Series, Search, and the unified player must use these
 * thresholds instead of local magic numbers.
 */

export const MIN_CONTINUE_WATCHING_POSITION_MS = 60_000;
export const COMPLETED_PROGRESS_PERCENT = 92;
export const LONG_CONTENT_MIN_DURATION_MS = 10 * 60 * 1000;
export const LONG_CONTENT_REMAINING_MS = 5 * 60 * 1000;
export const PROGRESS_SAVE_INTERVAL_MS = 12_000;
export const UP_NEXT_COUNTDOWN_SECONDS = 10;
export const UP_NEXT_REMAINING_MS = UP_NEXT_COUNTDOWN_SECONDS * 1000;
export const SEEK_STEP_MS = 10_000;
export const SEEK_ACCELERATION_STEPS_MS = [10_000, 30_000, 60_000] as const;
export const SEEK_ACCELERATION_WINDOW_MS = 450;
export const LIVE_CHANNEL_SURF_DEBOUNCE_MS = 280;

export type PlaybackResumeSource = 'continue-watching' | 'recent-resume' | 'standard';
export type PlaybackResumePolicy = 'silent' | 'prompt' | 'start';
export type PlaybackResumeChoice = 'resume' | 'restart' | 'cancel';

export function clampSeekPosition(positionMs: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }
  if (!Number.isFinite(positionMs)) {
    return 0;
  }
  return Math.max(0, Math.min(positionMs, durationMs));
}

export function getPlaybackPercentage(positionMs: number, durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }
  return Math.min(100, Math.round((clampSeekPosition(positionMs, durationMs) / durationMs) * 100));
}

export function isPlaybackComplete(positionMs: number, durationMs: number): boolean {
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return false;
  }

  const safePosition = clampSeekPosition(positionMs, durationMs);
  if (getPlaybackPercentage(safePosition, durationMs) >= COMPLETED_PROGRESS_PERCENT) {
    return true;
  }

  const remainingMs = Math.max(0, durationMs - safePosition);
  return durationMs >= LONG_CONTENT_MIN_DURATION_MS && remainingMs <= LONG_CONTENT_REMAINING_MS;
}

export function isResumeEligible(positionMs: number, durationMs: number): boolean {
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return false;
  }
  if (positionMs < MIN_CONTINUE_WATCHING_POSITION_MS) {
    return false;
  }
  return !isPlaybackComplete(positionMs, durationMs);
}

export function isContinueWatchingEligible(positionMs: number, durationMs: number): boolean {
  return isResumeEligible(positionMs, durationMs);
}

export function shouldRecordContinueWatching(positionMs: number, durationMs: number): boolean {
  return isResumeEligible(positionMs, durationMs);
}

export function shouldSaveProgress(lastSavedAt: number, now = Date.now()): boolean {
  return now - lastSavedAt >= PROGRESS_SAVE_INTERVAL_MS;
}

export function resolvePlaybackResumePolicy(source: PlaybackResumeSource, positionMs: number, durationMs: number): PlaybackResumePolicy {
  if (!isResumeEligible(positionMs, durationMs)) {
    return 'start';
  }
  if (source === 'continue-watching' || source === 'recent-resume') {
    return 'silent';
  }
  return 'prompt';
}

export function formatPlaybackClock(positionMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(positionMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatSeasonEpisode(seasonNumber?: string | null, episodeNumber?: string | null): string | null {
  if (!seasonNumber || !episodeNumber) {
    return null;
  }
  return `S${seasonNumber}:E${episodeNumber}`;
}

export function parseEpisodeIndex(value: string | undefined | null): number | null {
  if (!value) {
    return null;
  }
  const match = String(value).match(/(\d+)/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function sortEpisodesByNumber<T extends { seasonNumber: string; episodeNumber: string }>(episodes: T[]): T[] {
  return [...episodes].sort((left, right) => {
    const leftSeason = parseEpisodeIndex(left.seasonNumber) ?? Number.MAX_SAFE_INTEGER;
    const rightSeason = parseEpisodeIndex(right.seasonNumber) ?? Number.MAX_SAFE_INTEGER;
    if (leftSeason !== rightSeason) {
      return leftSeason - rightSeason;
    }
    return (parseEpisodeIndex(left.episodeNumber) ?? Number.MAX_SAFE_INTEGER) -
      (parseEpisodeIndex(right.episodeNumber) ?? Number.MAX_SAFE_INTEGER);
  });
}

export function getNextEpisode<T extends { seasonNumber: string; episodeNumber: string }>(
  episodes: T[],
  current: { seasonNumber: string; episodeNumber: string },
): T | null {
  if (!episodes.length) {
    return null;
  }

  const sorted = sortEpisodesByNumber(episodes);

  const currentSeason = parseEpisodeIndex(current.seasonNumber);
  const currentEpisode = parseEpisodeIndex(current.episodeNumber);
  if (currentSeason == null || currentEpisode == null) {
    const index = sorted.findIndex(
      (episode) => episode.seasonNumber === current.seasonNumber && episode.episodeNumber === current.episodeNumber,
    );
    return index >= 0 ? sorted[index + 1] ?? null : null;
  }

  return sorted.find((episode) => {
    const season = parseEpisodeIndex(episode.seasonNumber);
    const number = parseEpisodeIndex(episode.episodeNumber);
    if (season == null || number == null) {
      return false;
    }
    return season > currentSeason || (season === currentSeason && number > currentEpisode);
  }) ?? null;
}

export function getPreviousEpisode<T extends { seasonNumber: string; episodeNumber: string }>(
  episodes: T[],
  current: { seasonNumber: string; episodeNumber: string },
): T | null {
  if (!episodes.length) {
    return null;
  }

  const sorted = sortEpisodesByNumber(episodes);

  const currentSeason = parseEpisodeIndex(current.seasonNumber);
  const currentEpisode = parseEpisodeIndex(current.episodeNumber);
  if (currentSeason == null || currentEpisode == null) {
    const index = sorted.findIndex(
      (episode) => episode.seasonNumber === current.seasonNumber && episode.episodeNumber === current.episodeNumber,
    );
    return index > 0 ? sorted[index - 1] ?? null : null;
  }

  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const episode = sorted[index];
    const season = parseEpisodeIndex(episode.seasonNumber);
    const number = parseEpisodeIndex(episode.episodeNumber);
    if (season == null || number == null) {
      continue;
    }
    if (season < currentSeason || (season === currentSeason && number < currentEpisode)) {
      return episode;
    }
  }

  return null;
}

export function sliceUpcomingEpisodes<T extends { seasonNumber: string; episodeNumber: string }>(
  episodes: T[],
  current: { seasonNumber: string; episodeNumber: string },
): T[] {
  const upcoming: T[] = [];
  const seen = new Set<string>();
  let cursor = current;

  while (upcoming.length < 40) {
    const next = getNextEpisode(episodes, cursor);
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

export function resolveAcceleratedSeekDelta(input: {
  direction: 1 | -1;
  repeatCount: number;
}): number {
  const magnitudeIndex = input.repeatCount >= 12 ? 2 : input.repeatCount >= 5 ? 1 : 0;
  return SEEK_ACCELERATION_STEPS_MS[magnitudeIndex] * input.direction;
}

export const SERIES_EPISODE_END_TOLERANCE_MS = 1250;

export function isPlaybackNaturallyFinished(positionMs: number, durationMs: number): boolean {
  if (!Number.isFinite(positionMs) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return false;
  }
  // Natural end is the last ~1.25s of the stream, not the 92% Continue Watching
  // "completed" threshold. Closing or autoplaying at 92% dumps the user early.
  return positionMs >= Math.max(0, durationMs - SERIES_EPISODE_END_TOLERANCE_MS);
}

export function resolveSurfedChannelId(
  channelIds: string[],
  currentId: string | null,
  delta: 1 | -1,
): string | null {
  if (!channelIds.length) {
    return null;
  }
  const index = currentId ? channelIds.indexOf(currentId) : -1;
  const from = index >= 0 ? index : 0;
  const next = (from + delta) % channelIds.length;
  const wrapped = next < 0 ? next + channelIds.length : next;
  return channelIds[wrapped] ?? null;
}

export function shouldHandleLiveChannelSurf(input: {
  isLive: boolean;
  fullscreenActive: boolean;
  modalOpen: boolean;
  chromeVisible?: boolean;
  controlsFocused?: boolean;
}): boolean {
  if (!input.isLive || !input.fullscreenActive) {
    return false;
  }
  // Chrome and retry focus must not block surf; LEFT/RIGHT still change channels.
  if (input.modalOpen) {
    return false;
  }
  return true;
}
