export type GuideMemory = {
  /** Empty string means "no category chosen yet"; callers fall back to Live TV memory, then 'all'. */
  selectedCategoryId: string;
  focusedChannelId: string | null;
  focusedProgramId: string | null;
  selectedChannelId: string | null;
  selectedProgramId: string | null;
  focusedTimestamp: number | null;
  filter: 'all' | 'favorites';
  searchQuery: string;
  verticalOffset: number;
  horizontalOffset: number;
};

const DEFAULT_MEMORY: GuideMemory = {
  selectedCategoryId: '',
  focusedChannelId: 'n1',
  focusedProgramId: 'n1-0',
  selectedChannelId: 'n1',
  selectedProgramId: 'n1-0',
  focusedTimestamp: null,
  filter: 'all',
  searchQuery: '',
  verticalOffset: 0,
  horizontalOffset: 0,
};

const memoryByProvider = new Map<string, GuideMemory>();

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

export function getGuideMemory(providerId = 'demo-provider') {
  return getMemoryForProvider(providerId);
}

export function rememberGuideMemory(providerId: string, next: Partial<GuideMemory>) {
  memoryByProvider.set(providerId, {
    ...getMemoryForProvider(providerId),
    ...next,
  });
}

export function resetGuideMemory(providerId?: string) {
  if (providerId) {
    memoryByProvider.set(providerId, cloneDefaultMemory());
    return;
  }

  memoryByProvider.clear();
}
