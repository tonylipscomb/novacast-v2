import {
  formatPlaybackClock,
  formatSeasonEpisode,
  isResumeEligible,
  type PlaybackResumeChoice,
  type PlaybackResumePolicy,
} from './playbackContinuity.ts';

export type PlaybackResumePrompt = {
  contentId: string;
  mediaType: 'movie' | 'episode';
  title: string;
  seasonNumber?: string;
  episodeNumber?: string;
  positionMs: number;
  durationMs: number;
};

type PendingResumePrompt = PlaybackResumePrompt & {
  resolve: (choice: PlaybackResumeChoice) => void;
};

let pending: PendingResumePrompt | null = null;
let snapshot: PlaybackResumePrompt | null = null;
let epoch = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function logResumeGate(
  event: string,
  fields: {
    contentId?: string;
    mediaType?: 'movie' | 'episode';
    resumePositionPresent?: boolean;
    action?: PlaybackResumeChoice | 'error';
  },
) {
  console.info('[NovaCast Resume Gate]', event, fields);
}

function toSnapshot(value: PendingResumePrompt | null): PlaybackResumePrompt | null {
  if (!value) {
    return null;
  }
  return {
    contentId: value.contentId,
    mediaType: value.mediaType,
    title: value.title,
    seasonNumber: value.seasonNumber,
    episodeNumber: value.episodeNumber,
    positionMs: value.positionMs,
    durationMs: value.durationMs,
  };
}

function replacePending(next: PendingResumePrompt | null) {
  pending = next;
  snapshot = toSnapshot(next);
  epoch += 1;
  emit();
}

export function subscribePlaybackResumePrompt(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPlaybackResumePrompt(): PlaybackResumePrompt | null {
  return snapshot;
}

export function isPlaybackResumePromptOpen(): boolean {
  return snapshot != null;
}

export function getPlaybackResumeEpoch(): number {
  return epoch;
}

export function resolvePlaybackResumePrompt(choice: PlaybackResumeChoice) {
  const current = pending;
  if (!current) {
    return;
  }

  logResumeGate(
    choice === 'resume' ? 'resume-selected' : choice === 'restart' ? 'restart-selected' : 'dialog-cancelled',
    {
      contentId: current.contentId,
      mediaType: current.mediaType,
      resumePositionPresent: current.positionMs > 0,
      action: choice,
    },
  );

  replacePending(null);
  logResumeGate('gate-resolved', {
    contentId: current.contentId,
    mediaType: current.mediaType,
    resumePositionPresent: current.positionMs > 0,
    action: choice,
  });
  current.resolve(choice);
}

export function cancelPlaybackResumePrompt() {
  resolvePlaybackResumePrompt('cancel');
}

export async function requestPlaybackResumeChoice(prompt: PlaybackResumePrompt): Promise<PlaybackResumeChoice> {
  if (pending) {
    const previous = pending;
    pending = null;
    previous.resolve('cancel');
  }

  return new Promise((resolve) => {
    replacePending({ ...prompt, resolve });
    logResumeGate('dialog-opened', {
      contentId: prompt.contentId,
      mediaType: prompt.mediaType,
      resumePositionPresent: prompt.positionMs > 0,
    });
  });
}

export function describeResumePrompt(prompt: PlaybackResumePrompt) {
  const clock = formatPlaybackClock(prompt.positionMs);
  const episodeLabel = formatSeasonEpisode(prompt.seasonNumber, prompt.episodeNumber);
  if (prompt.mediaType === 'episode') {
    return {
      heading: 'Resume Episode',
      detail: episodeLabel ? `${episodeLabel}\nContinue from ${clock}?` : `Continue from ${clock}?`,
      resumeLabel: 'Resume',
      restartLabel: 'Restart Episode',
    };
  }

  return {
    heading: 'Resume Watching',
    detail: `Continue from ${clock}?`,
    resumeLabel: 'Resume',
    restartLabel: 'Restart from Beginning',
  };
}

export async function resolveLaunchResumePosition(input: {
  policy: PlaybackResumePolicy;
  contentId: string;
  mediaType: 'movie' | 'episode';
  title: string;
  positionMs: number;
  durationMs: number;
  seasonNumber?: string;
  episodeNumber?: string;
}): Promise<{ action: 'launch'; resumePositionMs: number; resetProgress: boolean } | { action: 'cancel' }> {
  if (input.policy === 'start' || !isResumeEligible(input.positionMs, input.durationMs)) {
    return { action: 'launch', resumePositionMs: 0, resetProgress: input.policy === 'start' && input.positionMs > 0 };
  }

  if (input.policy === 'silent') {
    return { action: 'launch', resumePositionMs: input.positionMs, resetProgress: false };
  }

  const choice = await requestPlaybackResumeChoice({
    contentId: input.contentId,
    mediaType: input.mediaType,
    title: input.title,
    seasonNumber: input.seasonNumber,
    episodeNumber: input.episodeNumber,
    positionMs: input.positionMs,
    durationMs: input.durationMs,
  });

  if (choice === 'cancel') {
    return { action: 'cancel' };
  }

  if (choice === 'restart') {
    return { action: 'launch', resumePositionMs: 0, resetProgress: true };
  }

  return { action: 'launch', resumePositionMs: input.positionMs, resetProgress: false };
}

export function resetPlaybackResumeGateForTests() {
  pending = null;
  snapshot = null;
  epoch += 1;
}
