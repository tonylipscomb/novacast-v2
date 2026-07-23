import type { SearchScope } from './searchTypes';

export type SearchScreenMemory = {
  query: string;
  scope: SearchScope;
  focusedResultKey: string | null;
};

const DEFAULT_MEMORY: SearchScreenMemory = {
  query: '',
  scope: 'all',
  focusedResultKey: null,
};

const memoryByProvider = new Map<string, SearchScreenMemory>();

function getDefaultMemory(): SearchScreenMemory {
  return { ...DEFAULT_MEMORY };
}

function getMemoryForProvider(providerId: string) {
  const existing = memoryByProvider.get(providerId);
  if (existing) {
    return existing;
  }

  const next = getDefaultMemory();
  memoryByProvider.set(providerId, next);
  return next;
}

export function getSearchScreenMemory(providerId: string) {
  return getMemoryForProvider(providerId);
}

export function rememberSearchScreenMemory(providerId: string, next: Partial<SearchScreenMemory>) {
  memoryByProvider.set(providerId, {
    ...getMemoryForProvider(providerId),
    ...next,
  });
}

export function resetSearchScreenMemory(providerId?: string) {
  if (providerId) {
    memoryByProvider.set(providerId, getDefaultMemory());
    return;
  }

  memoryByProvider.clear();
}
