import { DEFAULT_BROWSE_CATEGORY_ID } from '../media-browser/mediaCategoryUtils';

export type MoviesScreenMemory = {
  selectedCategoryId: string;
  focusedMovieId: string | null;
  selectedMovieId: string | null;
};

const DEFAULT_MEMORY: MoviesScreenMemory = {
  selectedCategoryId: DEFAULT_BROWSE_CATEGORY_ID,
  focusedMovieId: null,
  selectedMovieId: null,
};

const memoryByProvider = new Map<string, MoviesScreenMemory>();

function getDefaultMemory() {
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

export function getMoviesScreenMemory(providerId = 'demo-provider') {
  return getMemoryForProvider(providerId);
}

export function rememberMoviesScreenMemory(providerId: string, next: Partial<MoviesScreenMemory>) {
  memoryByProvider.set(providerId, {
    ...getMemoryForProvider(providerId),
    ...next,
  });
}

export function resetMoviesScreenMemory(providerId?: string) {
  if (providerId) {
    memoryByProvider.set(providerId, getDefaultMemory());
    return;
  }

  memoryByProvider.clear();
}
