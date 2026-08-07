import {
  isMultiRegionCategoryMarker,
  normalizeCountryCodeForDisplay,
} from '../series/metadata/titleNormalization.ts';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectCountryTokens(countryCode: string): string[] {
  const raw = countryCode.trim().toUpperCase();
  const tokens = new Set<string>();
  if (raw) {
    tokens.add(raw);
  }

  const display = normalizeCountryCodeForDisplay(countryCode).trim().toUpperCase();
  if (display) {
    tokens.add(display);
  }

  return [...tokens];
}

/**
 * Remove a redundant leading country token from a category label when that same
 * country is already shown by the region badge, so the row reads
 * "[US] News" instead of "[US] US News".
 *
 * Display-only: the returned string never feeds provider data, category IDs, or
 * filtering. Only a standalone country token that is a whole word (followed by a
 * delimiter, whitespace, or end-of-string) is stripped, so real titles such as
 * "USA Network" are preserved verbatim.
 */
export function dedupeCountryCategoryLabel(label: string, countryCode: string | undefined): string {
  const trimmed = (label ?? '').trim();
  if (!trimmed || !countryCode || isMultiRegionCategoryMarker(countryCode)) {
    return trimmed;
  }

  const tokens = collectCountryTokens(countryCode);
  if (tokens.length === 0) {
    return trimmed;
  }

  const alternation = tokens.map(escapeRegExp).join('|');
  // token, then either a delimiter (optionally spaced), one-or-more spaces, or end.
  const pattern = new RegExp(`^(?:${alternation})(?:\\s*[|｜¦:/·•–—\\-]\\s*|\\s+|$)`, 'i');

  if (!pattern.test(trimmed)) {
    return trimmed;
  }

  return trimmed.replace(pattern, '').trim();
}
