import { DEFAULT_BROWSE_CATEGORY_ID } from '../media-browser/mediaCategoryUtils';

type SeriesScreenMemory = {
  selectedCategoryId: string;
  focusedSeriesId: string | null;
  selectedSeriesId: string | null;
  selectedSeasonId: string | null;
};

const DEFAULT_MEMORY: SeriesScreenMemory = {
  selectedCategoryId: DEFAULT_BROWSE_CATEGORY_ID,
  focusedSeriesId: null,
  selectedSeriesId: null,
  selectedSeasonId: null,
};

const memoryByProvider = new Map<string, SeriesScreenMemory>();

export function getSeriesScreenMemory(providerId = 'demo-provider') {
  return memoryByProvider.get(providerId) ?? DEFAULT_MEMORY;
}

export function rememberSeriesScreenMemory(providerId: string, next: Partial<SeriesScreenMemory>) {
  const current = memoryByProvider.get(providerId) ?? DEFAULT_MEMORY;
  memoryByProvider.set(providerId, { ...current, ...next });
}

export function resetSeriesScreenMemory(providerId?: string) {
  if (providerId) {
    memoryByProvider.set(providerId, { ...DEFAULT_MEMORY });
    return;
  }
  memoryByProvider.clear();
}
