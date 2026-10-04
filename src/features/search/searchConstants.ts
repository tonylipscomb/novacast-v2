/** Preview limit per content type when Global Search scope is All. */
export const GLOBAL_PREVIEW_LIMIT = 12;

/** Default page size for scoped and single-scope search results. */
export const SEARCH_PAGE_SIZE = 50;

/** Default debounce delay for Movies, Series, and shared search surfaces. */
export const SEARCH_DEBOUNCE_MS = 300;

/** Live TV gets a shorter debounce because channel search is an interactive TV control. */
export const LIVE_SEARCH_DEBOUNCE_MS = 150;

/** Provider fallback timeout when the local catalog index is not ready. */
export const SEARCH_PROVIDER_FALLBACK_TIMEOUT_MS = 8_000;

/** Minimum query length before searching (short numeric/channel names exempt). */
export const SEARCH_MIN_QUERY_LENGTH = 2;

/** Maximum recent search history entries stored locally. */
export const SEARCH_HISTORY_MAX_ENTRIES = 12;
