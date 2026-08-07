/**
 * Stage 4.2R — Home + Navigation Stability.
 *
 * In-memory, per-provider store for the Home (main-menu) screen so that
 * returning to Home from Movies/Series/Live/Search restores the originating
 * card and vertical scroll position instead of resetting to the first card.
 *
 * Mirrors the shape/behaviour of moviesScreenMemory / seriesScreenMemory:
 * a plain Map keyed by providerId, no persistence (session lifetime only).
 */

export type HomeScreenMemory = {
  /** Resolved preferred-focus id of the last focused Home card, e.g. `recent-movie-abc`. */
  focusedCardId: string | null;
  /** Last vertical scroll offset of the Home ScrollView. */
  scrollOffsetY: number;
};

const DEFAULT_MEMORY: HomeScreenMemory = {
  focusedCardId: null,
  scrollOffsetY: 0,
};

const memoryByProvider = new Map<string, HomeScreenMemory>();

function getDefaultMemory(): HomeScreenMemory {
  return { ...DEFAULT_MEMORY };
}

function getMemoryForProvider(providerId: string): HomeScreenMemory {
  const existing = memoryByProvider.get(providerId);
  if (existing) {
    return existing;
  }
  const next = getDefaultMemory();
  memoryByProvider.set(providerId, next);
  return next;
}

export function getHomeScreenMemory(providerId = 'demo-provider'): HomeScreenMemory {
  return getMemoryForProvider(providerId);
}

export function rememberHomeScreenMemory(providerId: string, next: Partial<HomeScreenMemory>): void {
  memoryByProvider.set(providerId, {
    ...getMemoryForProvider(providerId),
    ...next,
  });
}

export function resetHomeScreenMemory(providerId?: string): void {
  if (providerId) {
    memoryByProvider.set(providerId, getDefaultMemory());
    return;
  }
  memoryByProvider.clear();
}

/**
 * Snapshot shape consumed by {@link resolveHomeInitialFocusId}. Kept minimal so
 * this resolver stays pure and unit-testable without importing the full
 * personalization model.
 */
export type HomeFocusSnapshot = {
  providerId: string;
  recentlyWatched: { mediaType: string; contentId: string }[];
  continueWatching: { contentId: string }[];
  favoriteChannels: { id: string }[];
  favoriteMovies: { id: string }[];
  favoriteSeries: { id: string }[];
};

/**
 * Builds the ordered list of candidate focus ids for a Home snapshot, matching
 * the row order rendered by MainMenuScreen: Recently Watched (first item only,
 * mirrors the on-screen slice), Continue Watching, Favorite Channels, Favorite
 * Movies, Favorite Series.
 */
export function collectHomeFocusableIds(snapshot: HomeFocusSnapshot, activeProviderId: string): string[] {
  if (snapshot.providerId !== activeProviderId) {
    return [];
  }
  const ids: string[] = [];
  for (const item of snapshot.recentlyWatched) {
    ids.push(`recent-${item.mediaType}-${item.contentId}`);
  }
  for (const item of snapshot.continueWatching) {
    ids.push(`continue-${item.contentId}`);
  }
  for (const item of snapshot.favoriteChannels) {
    ids.push(`favorite-channel-${item.id}`);
  }
  for (const item of snapshot.favoriteMovies) {
    ids.push(`favorite-movie-${item.id}`);
  }
  for (const item of snapshot.favoriteSeries) {
    ids.push(`favorite-series-${item.id}`);
  }
  return ids;
}

/**
 * Deterministically resolves the single Home card that should own initial focus.
 *
 * Rules (in priority order):
 * 1. While a guided walkthrough is visible, Home content owns no focus (null).
 * 2. If a remembered focus target still exists in the current snapshot, restore
 *    it — this is the Home-return restoration path.
 * 3. Otherwise fall back to the first focusable card in row order.
 * 4. If nothing is focusable, return null so the shell navbar keeps focus.
 *
 * The result is intended to be captured ONCE per Home mount and then frozen, so
 * later background/debounced personalization refreshes cannot steal focus.
 */
export function resolveHomeInitialFocusId(
  snapshot: HomeFocusSnapshot,
  activeProviderId: string,
  options: { guideVisible: boolean; rememberedFocusId?: string | null },
): string | null {
  if (options.guideVisible) {
    return null;
  }
  const focusable = collectHomeFocusableIds(snapshot, activeProviderId);
  if (focusable.length === 0) {
    return null;
  }
  const remembered = options.rememberedFocusId ?? null;
  if (remembered && focusable.includes(remembered)) {
    return remembered;
  }
  return focusable[0];
}
