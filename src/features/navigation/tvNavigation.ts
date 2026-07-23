export type TvNavigationGate = {
  lockedUntil: number;
};

export type HubDestinationId = 'live' | 'movies' | 'series' | 'guide';

const DEFAULT_GATE_LOCK_MS = 350;

let rememberedHubDestination: HubDestinationId = 'live';

export function createTvNavigationGate(): TvNavigationGate {
  return {
    lockedUntil: 0,
  };
}

export function tryAcquireTvNavigationGate(
  gate: TvNavigationGate,
  now = Date.now(),
  lockMs = DEFAULT_GATE_LOCK_MS,
) {
  if (now < gate.lockedUntil) {
    return false;
  }

  gate.lockedUntil = now + lockMs;
  return true;
}

export function rememberHubDestination(destinationId: HubDestinationId) {
  rememberedHubDestination = destinationId;
}

export function getRememberedHubDestination(defaultDestination: HubDestinationId = 'live') {
  return rememberedHubDestination ?? defaultDestination;
}

export function resetHubDestinationMemory(defaultDestination: HubDestinationId = 'live') {
  rememberedHubDestination = defaultDestination;
}
