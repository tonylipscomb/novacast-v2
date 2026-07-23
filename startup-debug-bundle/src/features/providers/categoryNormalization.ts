export type ProviderCategoryContentType = 'live' | 'movie' | 'series';

export const FALLBACK_PROVIDER_CATEGORY_NAME = 'Uncategorized';

const QUALITY_ONLY_NAMES = new Set([
  '4K',
  '8K',
  'HD',
  'FHD',
  'UHD',
  'SD',
  'HDR',
  'HEVC',
  'H264',
  'H265',
  '720P',
  '1080P',
  '2160P',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const EDGE_SEPARATORS = /^[\s|:;,/\\>._-]+|[\s|:;,/\\>._-]+$/g;

export type NormalizedProviderCategory = {
  id: string;
  name: string;
  hasProviderId: boolean;
  usedFallbackName: boolean;
  reason?: 'empty' | 'object' | 'punctuation' | 'numeric-without-id' | 'quality-without-id' | 'missing-provider-id';
};

function decodeHtmlEntities(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, token: string) => {
    const normalizedToken = token.toLowerCase();
    if (normalizedToken.startsWith('#x')) {
      const codePoint = Number.parseInt(normalizedToken.slice(2), 16);
      return codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    }

    if (normalizedToken.startsWith('#')) {
      const codePoint = Number.parseInt(normalizedToken.slice(1), 10);
      return codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
    }

    return NAMED_ENTITIES[normalizedToken] ?? entity;
  });
}

function coerceCategoryText(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  if (value && typeof value === 'object') {
    return '[object Object]';
  }

  return '';
}

export function normalizeProviderCategoryText(value: unknown) {
  return decodeHtmlEntities(coerceCategoryText(value))
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(EDGE_SEPARATORS, '')
    .trim();
}

export function normalizeProviderCategoryId(value: unknown) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }

  return null;
}

export function fallbackProviderCategoryId(contentType: ProviderCategoryContentType) {
  return `uncategorized:${contentType}`;
}

/**
 * Coarse content-type classification derived from a category (or channel)
 * display name's keywords. Shared by `mapXtreamCategory`'s icon assignment
 * and the Live TV home-card accent color lookup so the two can never drift
 * out of sync — add new keyword branches here, not in either call site.
 */
export type ProviderCategoryType = 'news' | 'sports' | 'movies' | 'kids' | 'music' | 'international' | 'general';

export function classifyProviderCategoryType(name: string): ProviderCategoryType {
  const normalized = name.toLowerCase();

  if (normalized.includes('sport')) {
    return 'sports';
  }
  if (normalized.includes('news')) {
    return 'news';
  }
  if (normalized.includes('movie')) {
    return 'movies';
  }
  if (normalized.includes('kid')) {
    return 'kids';
  }
  if (normalized.includes('music')) {
    return 'music';
  }
  if (normalized.includes('international')) {
    return 'international';
  }

  return 'general';
}

const CATEGORY_TYPE_ACCENT_COLORS: Record<ProviderCategoryType, string> = {
  news: '#FF6B7A',
  sports: '#33D39A',
  movies: '#A78BFA',
  kids: '#FFD166',
  music: '#FFB86A',
  international: '#3B82F6',
  general: '#3B82F6',
};

/** Glanceable accent color for a category type, used on Live TV channel cards. */
export function categoryTypeAccentColor(type: ProviderCategoryType): string {
  return CATEGORY_TYPE_ACCENT_COLORS[type];
}

const CATEGORY_TYPE_LABELS: Record<ProviderCategoryType, string> = {
  news: 'News',
  sports: 'Sports',
  movies: 'Movies',
  kids: 'Kids & Family',
  music: 'Music',
  international: 'International',
  general: 'Entertainment',
};

/** Human-readable label for a category type, used in the channel-card text fallback. */
export function categoryTypeLabel(type: ProviderCategoryType): string {
  return CATEGORY_TYPE_LABELS[type];
}

function invalidCategoryNameReason(name: string, hasProviderId: boolean): NormalizedProviderCategory['reason'] {
  if (!name) {
    return 'empty';
  }

  if (name.toLowerCase() === '[object object]') {
    return 'object';
  }

  if (!/[\p{L}\p{N}]/u.test(name)) {
    return 'punctuation';
  }

  if (!hasProviderId && /^\d+$/.test(name)) {
    return 'numeric-without-id';
  }

  if (!hasProviderId && QUALITY_ONLY_NAMES.has(name.toUpperCase())) {
    return 'quality-without-id';
  }

  return undefined;
}

export function normalizeProviderCategory(input: {
  contentType: ProviderCategoryContentType;
  id: unknown;
  name: unknown;
}): NormalizedProviderCategory {
  const providerId = normalizeProviderCategoryId(input.id);
  const hasProviderId = providerId !== null;
  const normalizedName = normalizeProviderCategoryText(input.name);
  const reason = invalidCategoryNameReason(normalizedName, hasProviderId) ?? (!hasProviderId ? 'missing-provider-id' : undefined);

  return {
    id: providerId ?? fallbackProviderCategoryId(input.contentType),
    name: reason ? FALLBACK_PROVIDER_CATEGORY_NAME : normalizedName,
    hasProviderId,
    usedFallbackName: Boolean(reason),
    reason,
  };
}
