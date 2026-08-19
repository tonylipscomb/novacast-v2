import { isNovaCastTraceLoggingEnabled } from '../diagnostics/novacastLogPolicy.ts';

export type VodBufferOptions = {
  preferredForwardBufferDuration: number;
  maxBufferBytes: number;
  minBufferForPlayback: number;
  prioritizeTimeOverSizeThreshold: boolean;
};

export type VodBufferProfileName = 'constrained' | 'normal';

export type VodBufferProfile = {
  name: VodBufferProfileName;
  bufferOptions: VodBufferOptions;
};

/** Java heap at or below this uses the Fire-TV-safe VOD cap. */
export const VOD_CONSTRAINED_HEAP_BYTES = 192 * 1024 * 1024;

/**
 * Media3 DefaultLoadControl DEFAULT_VIDEO_BUFFER_SIZE is
 * 2000 * 64KB = 128MB when maxBufferBytes is unset. That equals the AFTSS
 * Java heap growth limit and is what DefaultAllocator hits after a few
 * minutes of progressive MKV.
 */
export const CONSTRAINED_VOD_BUFFER: VodBufferProfile = {
  name: 'constrained',
  bufferOptions: {
    preferredForwardBufferDuration: 10,
    maxBufferBytes: 10 * 1024 * 1024,
    minBufferForPlayback: 0.75,
    prioritizeTimeOverSizeThreshold: false,
  },
};

export const NORMAL_VOD_BUFFER: VodBufferProfile = {
  name: 'normal',
  bufferOptions: {
    preferredForwardBufferDuration: 20,
    maxBufferBytes: 24 * 1024 * 1024,
    minBufferForPlayback: 1,
    prioritizeTimeOverSizeThreshold: false,
  },
};

const activeVodGenerations = new Set<number>();
let cachedHeapLimitBytes: number | null = null;
let heapProbeStarted = false;
const heapListeners = new Set<() => void>();

export function getCachedVodHeapLimitBytes() {
  return cachedHeapLimitBytes;
}

export function resolveVodBufferProfile(heapLimitBytes: number | null = cachedHeapLimitBytes): VodBufferProfile {
  if (heapLimitBytes != null && heapLimitBytes > VOD_CONSTRAINED_HEAP_BYTES) {
    return NORMAL_VOD_BUFFER;
  }
  return CONSTRAINED_VOD_BUFFER;
}

export function subscribeVodHeapProfile(listener: () => void) {
  heapListeners.add(listener);
  return () => {
    heapListeners.delete(listener);
  };
}

export async function primeVodHeapLimit(): Promise<number | null> {
  if (cachedHeapLimitBytes != null) {
    return cachedHeapLimitBytes;
  }
  if (heapProbeStarted) {
    return cachedHeapLimitBytes;
  }
  heapProbeStarted = true;
  try {
    const Device = await import('expo-device');
    const bytes = await Device.getMaxMemoryAsync();
    cachedHeapLimitBytes = Number.isFinite(bytes) && bytes > 0 ? bytes : 128 * 1024 * 1024;
  } catch {
    cachedHeapLimitBytes = 128 * 1024 * 1024;
  }
  heapListeners.forEach((listener) => listener());
  return cachedHeapLimitBytes;
}

export function getActiveVodPlayerCount() {
  return activeVodGenerations.size;
}

export function noteVodPlayerCreated(generationId: number) {
  activeVodGenerations.add(generationId);
}

export function noteVodPlayerReleased(generationId: number) {
  activeVodGenerations.delete(generationId);
}

export function applyVodBufferProfile(
  player: {
    bufferOptions: {
      preferredForwardBufferDuration?: number;
      maxBufferBytes?: number | null;
      minBufferForPlayback?: number;
      prioritizeTimeOverSizeThreshold?: boolean;
    };
  },
  profile: VodBufferProfile = resolveVodBufferProfile(),
) {
  player.bufferOptions = { ...profile.bufferOptions };
  return profile;
}

export function logVodPlayerMemory(event: string, payload: Record<string, unknown> = {}) {
  if (event !== 'playback-error' && !isNovaCastTraceLoggingEnabled()) {
    return;
  }
  const profile = resolveVodBufferProfile();
  console.info('[NovaCast VOD Player Memory]', {
    marker: 'rc-firetv-vod-heap-bound',
    event,
    profile: profile.name,
    maxBufferBytes: profile.bufferOptions.maxBufferBytes ?? null,
    preferredForwardBufferDuration: profile.bufferOptions.preferredForwardBufferDuration ?? null,
    minBufferForPlayback: profile.bufferOptions.minBufferForPlayback ?? null,
    prioritizeTimeOverSizeThreshold: profile.bufferOptions.prioritizeTimeOverSizeThreshold ?? false,
    heapLimitBytes: cachedHeapLimitBytes,
    activeVodPlayerCount: activeVodGenerations.size,
    ...payload,
  });
}

export function resetVodPlayerMemoryForTests() {
  activeVodGenerations.clear();
  cachedHeapLimitBytes = null;
  heapProbeStarted = false;
  heapListeners.clear();
}
