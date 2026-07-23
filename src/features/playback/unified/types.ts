export type PlaybackMediaType = 'live' | 'movie' | 'episode';

export type PlaybackItem = {
  id: string;
  mediaType: PlaybackMediaType;
  title: string;
  subtitle?: string;
  streamUrl: string;
  artworkUrl?: string;
  channelNumber?: string;
  isLive: boolean;
  resumePositionMs?: number;
  providerId?: string;
  seriesId?: string;
  seasonNumber?: string;
  episodeNumber?: string;
  episodeId?: string;
};

/** VOD vs live presentation; Series/Live TV stages will extend this. */
export type PlaybackMode = 'movie' | 'episode' | 'live-preview' | 'live-fullscreen';

export type UnifiedPlayerMachineState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'error'
  | 'closing';

export type PlaybackLaunchSource = 'play' | 'poster' | 'channel' | 'episode' | null;

export type UnifiedPlayerState = {
  machineState: UnifiedPlayerMachineState;
  item: PlaybackItem | null;
  launchSource: PlaybackLaunchSource;
  errorMessage: string | null;
  controlsVisible: boolean;
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
  contentFit: 'contain' | 'cover' | 'fill';
};

export type LaunchPlaybackOptions = {
  launchSource?: PlaybackLaunchSource;
  contentFit?: 'contain' | 'cover' | 'fill';
  onClose?: () => void;
};
