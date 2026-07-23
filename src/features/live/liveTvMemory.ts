export type LiveTvMemory = {
  selectedCategoryId: string;
  selectedChannelId: string;
  focusedCategoryId: string | null;
  focusedChannelId: string | null;
};

const DEFAULT_MEMORY: LiveTvMemory = {
  selectedCategoryId: '',
  selectedChannelId: '',
  focusedCategoryId: null,
  focusedChannelId: null,
};

const memoryByProvider = new Map<string, LiveTvMemory>();

function cloneDefaultMemory() {
  return { ...DEFAULT_MEMORY };
}

function getMemoryForProvider(providerId: string) {
  const existing = memoryByProvider.get(providerId);

  if (existing) {
    return existing;
  }

  const next = cloneDefaultMemory();
  memoryByProvider.set(providerId, next);
  return next;
}

export function getLiveTvMemory(providerId = 'demo-provider') {
  return getMemoryForProvider(providerId);
}

export function rememberLiveTvMemory(providerId: string, next: Partial<LiveTvMemory>) {
  memoryByProvider.set(providerId, {
    ...getMemoryForProvider(providerId),
    ...next,
  });
}

export function resetLiveTvMemory(providerId?: string) {
  if (providerId) {
    memoryByProvider.set(providerId, cloneDefaultMemory());
    return;
  }

  memoryByProvider.clear();
}
