export type LivePlaybackLaunchSource =
  | 'home_rail'
  | 'novapulse'
  | 'recommendations'
  | 'live_screen'
  | 'favorites'
  | 'recent';

export type LivePlaybackSurface = 'legacy' | 'modern_live';

export function logLivePlaybackSurfaceSelection(input: {
  launchSource: LivePlaybackLaunchSource;
  playbackSurface: LivePlaybackSurface;
  routeName: string;
}) {
  console.info('[NOVACAST_LIVE_PLAYBACK]', JSON.stringify({
    launchSource: input.launchSource,
    playbackSurface: input.playbackSurface,
    contentKind: 'live_channel',
    routeName: input.routeName,
    controlOverlayVersion: input.playbackSurface === 'modern_live' ? 'live-tv-modern-v1' : 'legacy',
  }));
}
