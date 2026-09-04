import { isSyntheticLiveCategoryId, sanitizePersistedLiveCategoryId } from '../providers/liveCategoryIdSafety.ts';

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

function sanitizeLiveTvMemory(memory: LiveTvMemory): LiveTvMemory {
  const selectedCategoryId = sanitizePersistedLiveCategoryId(memory.selectedCategoryId);
  const focusedCategoryId =
    memory.focusedCategoryId && !isSyntheticLiveCategoryId(memory.focusedCategoryId)
      ? memory.focusedCategoryId
      : selectedCategoryId || null;

  if (memory.selectedCategoryId === selectedCategoryId && memory.focusedCategoryId === focusedCategoryId) {
    return memory;
  }

  memory.selectedCategoryId = selectedCategoryId;
  memory.focusedCategoryId = focusedCategoryId;
  return memory;
}

export function getLiveTvMemory(providerId = 'demo-provider') {
  return sanitizeLiveTvMemory(getMemoryForProvider(providerId));
}

export function rememberLiveTvMemory(providerId: string, next: Partial<LiveTvMemory>) {
  const current = getMemoryForProvider(providerId);
  memoryByProvider.set(
    providerId,
    sanitizeLiveTvMemory({
      ...current,
      ...next,
    }),
  );
}

export function resetLiveTvMemory(providerId?: string) {
  if (providerId) {
    memoryByProvider.set(providerId, cloneDefaultMemory());
    return;
  }

  memoryByProvider.clear();
}
