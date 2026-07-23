export type PlaybackMediaKind = 'movie' | 'episode';

export type PlaybackProgressState = {
  positionMs: number;
  durationMs: number;
  progressPercent: number;
  isWatched: boolean;
};

export type NextEpisodeCandidate = {
  seriesId: string;
  seasonNumber: string;
  episodeNumber: string;
  episodeId: string;
  title: string;
  streamId: string;
  extension: string;
};

export type MediaPlayerControlAction =
  | 'play-pause'
  | 'rewind'
  | 'forward'
  | 'show-controls'
  | 'hide-controls'
  | 'settings'
  | 'close';
