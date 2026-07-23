import type { LaunchPlaybackOptions, PlaybackItem, UnifiedPlayerState } from './types.ts';
import { normalizeMediaTitle } from '../../series/metadata/titleNormalization.ts';

function logUnifiedStore(event: string, payload: Record<string, unknown> = {}) {
  console.info('[NovaCast Unified Player]', event, payload);
}

type UnifiedPlayerStoreSnapshot = UnifiedPlayerState & {
  onCloseCallback: (() => void) | null;
};

const initialState: UnifiedPlayerStoreSnapshot = {
  machineState: 'idle',
  item: null,
  launchSource: null,
  errorMessage: null,
  controlsVisible: true,
  positionMs: 0,
  durationMs: 0,
  isPlaying: true,
  contentFit: 'contain',
  onCloseCallback: null,
};

let state: UnifiedPlayerStoreSnapshot = { ...initialState };
let publicSnapshot: UnifiedPlayerState = {
  machineState: state.machineState,
  item: state.item,
  launchSource: state.launchSource,
  errorMessage: state.errorMessage,
  controlsVisible: state.controlsVisible,
  positionMs: state.positionMs,
  durationMs: state.durationMs,
  isPlaying: state.isPlaying,
  contentFit: state.contentFit,
};
const listeners = new Set<() => void>();

function syncPublicSnapshot() {
  publicSnapshot = {
    machineState: state.machineState,
    item: state.item,
    launchSource: state.launchSource,
    errorMessage: state.errorMessage,
    controlsVisible: state.controlsVisible,
    positionMs: state.positionMs,
    durationMs: state.durationMs,
    isPlaying: state.isPlaying,
    contentFit: state.contentFit,
  };
}

function notify() {
  listeners.forEach((listener) => listener());
}

function setState(patch: Partial<UnifiedPlayerStoreSnapshot>) {
  state = { ...state, ...patch };
  syncPublicSnapshot();
  notify();
}

export function getUnifiedPlayerState(): UnifiedPlayerState {
  return publicSnapshot;
}

export function getUnifiedPlayerCloseCallback(): (() => void) | null {
  return state.onCloseCallback;
}

export function subscribeUnifiedPlayer(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function launchUnifiedPlayback(item: PlaybackItem, options: LaunchPlaybackOptions = {}) {
  const normalizedItem: PlaybackItem = {
    ...item,
    title: normalizeMediaTitle(item.title) || item.title,
    subtitle: item.subtitle ? normalizeMediaTitle(item.subtitle) || item.subtitle : undefined,
  };

  const alreadyLaunchingSameItem =
    state.item?.id === normalizedItem.id &&
    state.item?.streamUrl === normalizedItem.streamUrl &&
    (state.machineState === 'loading' ||
      state.machineState === 'buffering' ||
      state.machineState === 'playing' ||
      state.machineState === 'paused' ||
      state.machineState === 'ready');

  if (alreadyLaunchingSameItem) {
    logUnifiedStore('launch-skipped-duplicate', {
      id: normalizedItem.id,
      machineState: state.machineState,
    });
    return;
  }

  logUnifiedStore('launch', {
    id: normalizedItem.id,
    mediaType: normalizedItem.mediaType,
    machineState: 'loading',
  });

  setState({
    machineState: 'loading',
    item: normalizedItem,
    launchSource: options.launchSource ?? null,
    errorMessage: null,
    controlsVisible: true,
    positionMs: normalizedItem.resumePositionMs ?? 0,
    durationMs: 0,
    isPlaying: true,
    contentFit: options.contentFit ?? 'contain',
    onCloseCallback: options.onClose ?? null,
  });
}

export function closeUnifiedPlayback() {
  const callback = state.onCloseCallback;
  logUnifiedStore('close', { id: state.item?.id ?? null, machineState: 'closing' });
  setState({
    machineState: 'closing',
    item: null,
    launchSource: state.launchSource,
    errorMessage: null,
    controlsVisible: true,
    positionMs: 0,
    durationMs: 0,
    isPlaying: false,
    onCloseCallback: null,
  });
  callback?.();
}

export function finishUnifiedPlaybackClose() {
  if (state.machineState !== 'closing') {
    return;
  }
  logUnifiedStore('finish-close', { machineState: 'idle' });
  setState({
    machineState: 'idle',
    launchSource: null,
  });
}

export function setUnifiedPlayerMachineState(machineState: UnifiedPlayerState['machineState']) {
  if (state.machineState === machineState) {
    return;
  }
  setState({ machineState });
}

export function setUnifiedPlayerError(message: string | null) {
  if (message && !state.item) {
    return;
  }

  setState({
    machineState: message ? 'error' : state.machineState === 'error' ? 'loading' : state.machineState,
    errorMessage: message,
  });
}

export function clearUnifiedPlayerError() {
  setState({
    errorMessage: null,
    machineState: state.item ? 'loading' : 'idle',
  });
}

export function setUnifiedPlayerControlsVisible(controlsVisible: boolean) {
  if (state.controlsVisible === controlsVisible) {
    return;
  }
  setState({ controlsVisible });
}

export function setUnifiedPlayerProgress(positionMs: number, durationMs: number) {
  if (state.positionMs === positionMs && state.durationMs === durationMs) {
    return;
  }
  setState({ positionMs, durationMs });
}

export function setUnifiedPlayerPlaying(isPlaying: boolean) {
  if (state.isPlaying === isPlaying) {
    return;
  }
  setState({ isPlaying });
}

export function resetUnifiedPlayerForTests() {
  state = { ...initialState };
  syncPublicSnapshot();
  listeners.clear();
}
