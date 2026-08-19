export type EpisodeNavigationDirection = 1 | -1;

export type EpisodeNavigationLogEvent =
  | 'previous-request'
  | 'next-request'
  | 'target-resolved'
  | 'source-resolved'
  | 'transition-start'
  | 'current-progress-saved'
  | 'transition-complete'
  | 'transition-failed'
  | 'duplicate-transition-blocked'
  | 'boundary-noop';

export function createEpisodeNavigationTransitionId(
  fromEpisodeId: string,
  toEpisodeId: string,
  direction: EpisodeNavigationDirection,
): string {
  return `${fromEpisodeId}:${toEpisodeId}:${direction < 0 ? 'previous' : 'next'}`;
}

export function logEpisodeNavigation(fields: {
  event: EpisodeNavigationLogEvent;
  seriesId?: string | null;
  fromEpisodeId?: string | null;
  toEpisodeId?: string | null;
  fromSeason?: string | null;
  fromEpisode?: string | null;
  toSeason?: string | null;
  toEpisode?: string | null;
  direction?: EpisodeNavigationDirection | null;
  transitionId?: string | null;
}): void {
  console.info(
    '[NovaCast Episode Navigation] ' +
      JSON.stringify({
        event: fields.event,
        seriesId: fields.seriesId ?? null,
        fromEpisodeId: fields.fromEpisodeId ?? null,
        toEpisodeId: fields.toEpisodeId ?? null,
        fromSeason: fields.fromSeason ?? null,
        fromEpisode: fields.fromEpisode ?? null,
        toSeason: fields.toSeason ?? null,
        toEpisode: fields.toEpisode ?? null,
        direction: fields.direction ?? null,
        transitionId: fields.transitionId ?? null,
      }),
  );
}
