import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { createVideoPlayer, type PlayingChangeEventPayload, type TimeUpdateEventPayload, type VideoPlayer } from 'expo-video';

import { NovaStreamSurface } from '@/features/playback/NovaStreamPlayer';
import { buildLiveChannelPlaybackSource } from '@/features/providers/providerPlayback';
import type { ProviderLiveChannel } from '@/features/providers/providerRepositories';
import type { ProviderRepositoryBundle } from '@/features/providers/providerBundle';

const PROBE_STAGES = [15_000, 30_000, 60_000, 120_000, 180_000] as const;

function safeText(value: unknown) {
  if (typeof value !== 'string') return null;
  return value.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[redacted-url]').slice(0, 160);
}

function classifyFailure(value: unknown) {
  const text = safeText(value) ?? '';
  if (/509|429|rate.?limit|too many requests/i.test(text)) return 'PROVIDER_CONNECTION_LIMIT';
  if (/401|403|unauthori[sz]ed|forbidden/i.test(text)) return 'SOURCE_FAILURE';
  if (/codec|decoder|mediacodec|allocation|resource/i.test(text)) return 'DEVICE_DECODER_LIMIT';
  if (/network|bandwidth|timeout|connection|dns|http/i.test(text)) return 'NETWORK/BANDWIDTH';
  return 'UNKNOWN';
}

function playerSnapshot(player: VideoPlayer) {
  const track = player.videoTrack as { width?: number; height?: number } | null;
  return {
    status: player.status,
    isPlaying: Boolean(player.playing),
    currentTime: Number.isFinite(player.currentTime) ? player.currentTime : null,
    duration: Number.isFinite(player.duration) ? player.duration : null,
    videoSize: track?.width && track?.height ? { width: track.width, height: track.height } : null,
  };
}

function emitProbe(stage: string, player: 'A' | 'B', channelKey: string, playerInstance: VideoPlayer, extra: Record<string, unknown> = {}) {
  const payload = {
    stage,
    player,
    channelKey: channelKey.slice(0, 120),
    ...playerSnapshot(playerInstance),
    errorCode: null,
    errorMessage: null,
    timestamp: Date.now(),
    ...extra,
  };
  console.log('[NovaCast NovaView Probe]', JSON.stringify(payload));
}

export type NovaViewProbeProps = {
  bundle: ProviderRepositoryBundle;
  playerA: VideoPlayer;
  channelA: ProviderLiveChannel;
  channelB: ProviderLiveChannel;
  onFirstFrameRender?: () => void;
  onPlayingChange?: (payload: PlayingChangeEventPayload) => void;
  onTimeUpdate?: (payload: TimeUpdateEventPayload) => void;
};

/** DEV-only two-stream capability probe. It is rendered only when explicitly enabled. */
export function NovaViewProbe({ bundle, playerA, channelA, channelB, onFirstFrameRender, onPlayingChange, onTimeUpdate }: NovaViewProbeProps) {
  const playerB = useMemo(() => createVideoPlayer(null), []);
  const [playerAStatus, setPlayerAStatus] = useState(() => String(playerA.status));
  const [playerBStatus, setPlayerBStatus] = useState(() => String(playerB.status));
  const disposedRef = useRef(false);
  const stageTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (playerA === playerB) throw new Error('novaview-player-identity-conflict');
    playerB.muted = true;
    playerB.volume = 0;
    const source = buildLiveChannelPlaybackSource(bundle, channelB);
    let bStarted = false;
    const logPlayer = (player: 'A' | 'B', instance: VideoPlayer, event: { status?: string; error?: unknown }) => {
      if (disposedRef.current) return;
      const errorText = safeText(event.error);
      if (player === 'A') setPlayerAStatus(String(instance.status));
      else setPlayerBStatus(String(instance.status));
      emitProbe(event.status === 'error' ? 'error' : 'state', player, player === 'A' ? channelA.id : channelB.id, instance, {
        errorCode: event.status === 'error' ? classifyFailure(errorText) : null,
        errorMessage: errorText,
      });
    };
    const aStatus = playerA.addListener('statusChange', (event) => logPlayer('A', playerA, event));
    const bStatus = playerB.addListener('statusChange', (event) => logPlayer('B', playerB, event));
    const loadingTimers = new Map<'A' | 'B', ReturnType<typeof setTimeout>>();
    const armLoadingTimer = (player: 'A' | 'B', instance: VideoPlayer) => {
      const existing = loadingTimers.get(player);
      if (existing) clearTimeout(existing);
      if (String(instance.status) !== 'loading') return;
      loadingTimers.set(player, setTimeout(() => {
        if (!disposedRef.current && String(instance.status) === 'loading') {
          emitProbe('loading-timeout', player, player === 'A' ? channelA.id : channelB.id, instance, {
            errorCode: 'SOURCE_FAILURE', errorMessage: 'loading-timeout',
          });
        }
      }, 10_000));
    };
    const aLoading = playerA.addListener('statusChange', () => armLoadingTimer('A', playerA));
    const bLoading = playerB.addListener('statusChange', () => armLoadingTimer('B', playerB));
    emitProbe('startup', 'A', channelA.id, playerA, { audio: 'on' });
    emitProbe('startup', 'B', channelB.id, playerB, { audio: 'off' });
    const bSourceReady = () => {
      if (disposedRef.current || bStarted) return;
      bStarted = true;
      // Mute and volume zero are set before this source load.
      void playerB.replaceAsync(source).then(() => {
        if (!disposedRef.current) playerB.play();
      }).catch((error) => {
        if (!disposedRef.current) logPlayer('B', playerB, { status: 'error', error });
      });
    };
    bSourceReady();
    for (const stageMs of PROBE_STAGES) {
      stageTimersRef.current.push(setTimeout(() => {
        if (disposedRef.current) return;
        const a = playerSnapshot(playerA);
        const b = playerSnapshot(playerB);
        console.log('[NovaCast NovaView Probe]', JSON.stringify({
          stage: `${stageMs / 1000}s`,
          playerAHealthy: a.status !== 'error' && a.isPlaying,
          playerBHealthy: b.status !== 'error' && b.isPlaying,
          simultaneousHealthy: a.status !== 'error' && b.status !== 'error' && a.isPlaying && b.isPlaying,
          timestamp: Date.now(),
        }));
      }, stageMs));
    }
    return () => {
      disposedRef.current = true;
      for (const timer of stageTimersRef.current) clearTimeout(timer);
      stageTimersRef.current = [];
      for (const timer of loadingTimers.values()) clearTimeout(timer);
      aStatus.remove();
      bStatus.remove();
      aLoading.remove();
      bLoading.remove();
      playerB.pause();
      playerB.release();
    };
  }, [bundle, channelA.id, channelB, channelB.id, playerA, playerB]);

  return (
    <View pointerEvents="none" style={styles.root}>
      <View style={styles.pane}>
        <NovaStreamSurface player={playerA} contentFit="contain" surfaceType="textureView" style={styles.video} onFirstFrameRender={onFirstFrameRender} onPlayingChange={onPlayingChange} onTimeUpdate={onTimeUpdate} />
        <View pointerEvents="none" style={styles.labelBox}>
          <Text style={styles.label}>A</Text><Text style={styles.label}>AUDIO</Text><Text style={styles.status}>{playerAStatus}</Text>
        </View>
      </View>
      <View style={styles.pane}>
        <NovaStreamSurface player={playerB} contentFit="contain" surfaceType="textureView" style={styles.video} />
        <View pointerEvents="none" style={styles.labelBox}>
          <Text style={styles.label}>B</Text><Text style={styles.label}>MUTED</Text><Text style={styles.status}>{playerBStatus}</Text>
        </View>
      </View>
      <View pointerEvents="none" style={styles.divider} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, width: '100%', height: '100%', flexDirection: 'row', backgroundColor: '#000' },
  pane: { flex: 1, position: 'relative', overflow: 'hidden' },
  video: { flex: 1, width: '100%', height: '100%' },
  labelBox: { position: 'absolute', top: 24, left: 24, zIndex: 20, elevation: 20, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: 'rgba(0, 0, 0, 0.78)' },
  label: { color: '#fff', fontSize: 22, fontWeight: '800' },
  status: { color: '#b8c2ff', fontSize: 15, fontWeight: '600' },
  divider: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 3, marginLeft: -1.5, zIndex: 30, elevation: 30, backgroundColor: '#aab4ff' },
});
