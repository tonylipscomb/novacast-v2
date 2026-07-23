type LaunchOverlayListener = () => void;

export type LaunchOverlayReason = 'pairing' | 'home';

type LaunchOverlayState = {
  visible: boolean;
  exiting: boolean;
  reason: LaunchOverlayReason | null;
};

let state: LaunchOverlayState = {
  visible: false,
  exiting: false,
  reason: null,
};

const OVERLAY_SAFETY_MS = 8_000;
let overlaySafetyTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<LaunchOverlayListener>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function getLaunchOverlayState() {
  return state;
}

export function subscribeLaunchOverlay(listener: LaunchOverlayListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function beginLaunchOverlay(reason: LaunchOverlayReason) {
  if (state.visible && state.exiting) {
    return;
  }

  state = {
    visible: true,
    exiting: false,
    reason,
  };

  if (overlaySafetyTimer) {
    clearTimeout(overlaySafetyTimer);
  }

  overlaySafetyTimer = setTimeout(() => {
    if (state.visible) {
      completeLaunchOverlay();
    }
    overlaySafetyTimer = null;
  }, OVERLAY_SAFETY_MS);

  emit();
}

export function requestLaunchOverlayExit() {
  if (!state.visible || state.exiting) {
    return;
  }

  state = {
    ...state,
    exiting: true,
  };
  emit();
}

export function completeLaunchOverlay() {
  if (overlaySafetyTimer) {
    clearTimeout(overlaySafetyTimer);
    overlaySafetyTimer = null;
  }

  state = {
    visible: false,
    exiting: false,
    reason: null,
  };
  emit();
}

export function resetLaunchOverlayForTests() {
  state = {
    visible: false,
    exiting: false,
    reason: null,
  };
  listeners.clear();
}
