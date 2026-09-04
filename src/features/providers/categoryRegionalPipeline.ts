import type { ProviderCategoryContentType } from './categoryNormalization.ts';
import {
  AUSTRALIA_REGION_MARKERS,
  BARE_US_LABEL_PATTERN,
  CANADA_REGION_MARKERS,
  CATEGORY_REGION_SORT_PRIORITY,
  DEPRIORITIZED_FOREIGN_LANGUAGE_MARKERS,
  DEPRIORITIZED_RELIGIOUS_MARKERS,
  EUROPE_COUNTRY_CODES,
  EUROPE_REGION_MARKERS,
  FOREIGN_COUNTRY_CODES,
  INTERNATIONAL_ENGLISH_MARKERS,
  LITERAL_ENGLISH_LABEL_PATTERN,
  type CategoryRegionGroup,
  UK_REGION_MARKERS,
  US_DEFAULT_DISPLAY_SUFFIX,
  US_REGION_MARKERS,
} from './categoryRegionalConfig.ts';
import { parseProviderTitlePrefix } from '../series/metadata/titleNormalization.ts';

export type CategoryScriptProfile = 'latin' | 'mixed' | 'foreign';

export type CategoryRegionalInput = {
  name: string;
  rawName?: string;
  countryCode?: string;
  contentType?: ProviderCategoryContentType;
};

export type CategoryRegionalProfile = {
  labels: string[];
  scriptProfile: CategoryScriptProfile;
  regionGroup: CategoryRegionGroup;
  sortPriority: number;
  sortLabel: string;
  displayName: string;
};

export type CategorySortLabel = CategoryRegionalInput;

export type CategoryRegionalSortMetrics = {
  profileBuildMs: number;
  actualSortMs: number;
  profileBuildCount: number;
  comparatorCalls: number;
  // DEV-only stage breakdown. Populated only when a metrics object is passed
  // through the audited cold path; production callers pass no metrics and pay
  // none of the per-stage timing overhead.
  titleParseMs?: number;
  scriptDetectMs?: number;
  regionClassifyMs?: number;
  displayNameMs?: number;
  sortKeyMs?: number;
  titleParseCount?: number;
  scriptDetectCount?: number;
  regionClassifyCount?: number;
};

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

const LETTER_PATTERN = /\p{L}/u;
const LATIN_LETTER_PATTERN = /\p{Script=Latin}/u;

// Reuse one collator for the within-group alphabetical comparison. Calling
// String.prototype.localeCompare with an options object constructs a fresh
// collator on every invocation; across ~7.7k comparisons for a 913-category
// cold Live load that per-call construction (a JNI/ICU round trip on Hermes)
// dominated the sort. A shared collator yields identical ordering.
const CATEGORY_SORT_COLLATOR: Pick<Intl.Collator, 'compare'> | null = (() => {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.Collator === 'function') {
      return new Intl.Collator(undefined, { sensitivity: 'base' });
    }
  } catch {
    // Fall through to the localeCompare path below.
  }
  return null;
})();

function compareSortLabels(left: string, right: string): number {
  if (CATEGORY_SORT_COLLATOR) {
    return CATEGORY_SORT_COLLATOR.compare(left, right);
  }
  return left.localeCompare(right, undefined, { sensitivity: 'base' });
}

function titleCaseWords(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function collectCategoryLabels(input: CategoryRegionalInput) {
  const labels = new Set<string>();
  if (input.rawName?.trim()) {
    labels.add(input.rawName.trim());
  }
  if (input.name?.trim()) {
    labels.add(input.name.trim());
  }
  return [...labels];
}

export function analyzeCategoryScriptProfile(labels: string[]): CategoryScriptProfile {
  let latinLetters = 0;
  let nonLatinLetters = 0;

  for (const label of labels) {
    for (const character of label) {
      if (!LETTER_PATTERN.test(character)) {
        continue;
      }

      if (LATIN_LETTER_PATTERN.test(character)) {
        latinLetters += 1;
      } else {
        nonLatinLetters += 1;
      }
    }
  }

  if (nonLatinLetters === 0) {
    return 'latin';
  }

  if (latinLetters === 0) {
    return 'foreign';
  }

  return nonLatinLetters > latinLetters ? 'foreign' : 'mixed';
}

function matchesAnyLabel(labels: string[], pattern: RegExp) {
  return labels.some((label) => pattern.test(label));
}

function matchesCountryCode(countryCode: string | undefined, codes: Set<string>) {
  return Boolean(countryCode && codes.has(countryCode));
}

function isUsRegion(labels: string[], countryCode?: string) {
  if (countryCode === 'US') {
    return true;
  }

  if (matchesAnyLabel(labels, US_REGION_MARKERS)) {
    return true;
  }

  return labels.some((label) => parseProviderTitlePrefix(label).countryCode === 'US');
}

function isCanadaRegion(labels: string[], countryCode?: string) {
  if (countryCode === 'CA') {
    return true;
  }

  if (matchesAnyLabel(labels, CANADA_REGION_MARKERS)) {
    return true;
  }

  return labels.some((label) => parseProviderTitlePrefix(label).countryCode === 'CA');
}

function isAustraliaRegion(labels: string[], countryCode?: string) {
  if (countryCode === 'AU') {
    return true;
  }

  if (matchesAnyLabel(labels, AUSTRALIA_REGION_MARKERS)) {
    return true;
  }

  return labels.some((label) => parseProviderTitlePrefix(label).countryCode === 'AU');
}

function isUkRegion(labels: string[], countryCode?: string) {
  if (countryCode === 'GB') {
    return true;
  }

  if (matchesAnyLabel(labels, UK_REGION_MARKERS)) {
    return true;
  }

  return labels.some((label) => {
    const parsed = parseProviderTitlePrefix(label).countryCode;
    return parsed === 'GB';
  });
}

function isEuropeRegion(labels: string[], countryCode?: string) {
  if (matchesCountryCode(countryCode, EUROPE_COUNTRY_CODES)) {
    return true;
  }

  if (matchesAnyLabel(labels, EUROPE_REGION_MARKERS)) {
    return true;
  }

  return labels.some((label) => {
    const parsed = parseProviderTitlePrefix(label).countryCode;
    return parsed ? EUROPE_COUNTRY_CODES.has(parsed) : false;
  });
}

function isInternationalEnglishRegion(labels: string[], countryCode?: string) {
  if (isUsRegion(labels, countryCode) || isUkRegion(labels, countryCode)) {
    return false;
  }

  return matchesAnyLabel(labels, INTERNATIONAL_ENGLISH_MARKERS);
}

function isDeprioritizedForeignLatin(labels: string[], countryCode?: string) {
  if (matchesCountryCode(countryCode, FOREIGN_COUNTRY_CODES)) {
    return true;
  }

  if (
    matchesAnyLabel(labels, DEPRIORITIZED_FOREIGN_LANGUAGE_MARKERS) ||
    matchesAnyLabel(labels, DEPRIORITIZED_RELIGIOUS_MARKERS)
  ) {
    return true;
  }

  return labels.some((label) => {
    const parsed = parseProviderTitlePrefix(label).countryCode;
    return parsed ? FOREIGN_COUNTRY_CODES.has(parsed) : false;
  });
}

type ParsedCategoryLabel = { label: string; countryCode?: string; title: string };

function parsedLabelsFor(labels: string[]): ParsedCategoryLabel[] {
  return labels.map((label) => {
    const parsed = parseProviderTitlePrefix(label);
    return { label, countryCode: parsed.countryCode, title: parsed.title };
  });
}

function hasParsedCountry(parsedLabels: ParsedCategoryLabel[], countryCode: string) {
  return parsedLabels.some((label) => label.countryCode === countryCode);
}

function isUsRegionFast(labels: string[], countryCode: string | undefined, parsedLabels: ParsedCategoryLabel[]) {
  return countryCode === 'US' || matchesAnyLabel(labels, US_REGION_MARKERS) || hasParsedCountry(parsedLabels, 'US');
}

function isUkRegionFast(labels: string[], countryCode: string | undefined, parsedLabels: ParsedCategoryLabel[]) {
  return countryCode === 'GB' || matchesAnyLabel(labels, UK_REGION_MARKERS) || hasParsedCountry(parsedLabels, 'GB');
}

function isCanadaRegionFast(labels: string[], countryCode: string | undefined, parsedLabels: ParsedCategoryLabel[]) {
  return countryCode === 'CA' || matchesAnyLabel(labels, CANADA_REGION_MARKERS) || hasParsedCountry(parsedLabels, 'CA');
}

function isAustraliaRegionFast(labels: string[], countryCode: string | undefined, parsedLabels: ParsedCategoryLabel[]) {
  return countryCode === 'AU' || matchesAnyLabel(labels, AUSTRALIA_REGION_MARKERS) || hasParsedCountry(parsedLabels, 'AU');
}

function resolveCategoryRegionGroupFromParsed(
  labels: string[],
  scriptProfile: CategoryScriptProfile,
  countryCode: string | undefined,
  parsedLabels: ParsedCategoryLabel[],
): CategoryRegionGroup {
  if (scriptProfile === 'foreign') return 'foreign';
  if (scriptProfile === 'mixed') return 'mixed';
  const us = isUsRegionFast(labels, countryCode, parsedLabels);
  const uk = isUkRegionFast(labels, countryCode, parsedLabels);
  if (us) return 'us';
  if (isCanadaRegionFast(labels, countryCode, parsedLabels)) return 'canada';
  if (isAustraliaRegionFast(labels, countryCode, parsedLabels)) return 'australia';
  if (!us && !uk && matchesAnyLabel(labels, INTERNATIONAL_ENGLISH_MARKERS)) return 'intlEnglish';
  if (uk) return 'uk';
  if (matchesCountryCode(countryCode, EUROPE_COUNTRY_CODES) || matchesAnyLabel(labels, EUROPE_REGION_MARKERS) || parsedLabels.some((label) => label.countryCode && EUROPE_COUNTRY_CODES.has(label.countryCode))) return 'europe';
  if (matchesCountryCode(countryCode, FOREIGN_COUNTRY_CODES) || matchesAnyLabel(labels, DEPRIORITIZED_FOREIGN_LANGUAGE_MARKERS) || matchesAnyLabel(labels, DEPRIORITIZED_RELIGIOUS_MARKERS) || parsedLabels.some((label) => label.countryCode && FOREIGN_COUNTRY_CODES.has(label.countryCode))) return 'foreign';
  return 'international';
}

export function resolveCategoryRegionGroup(
  labels: string[],
  scriptProfile: CategoryScriptProfile,
  countryCode?: string,
): CategoryRegionGroup {
  if (scriptProfile === 'foreign') {
    return 'foreign';
  }

  if (scriptProfile === 'mixed') {
    return 'mixed';
  }

  if (isUsRegion(labels, countryCode)) {
    return 'us';
  }

  if (isCanadaRegion(labels, countryCode)) {
    return 'canada';
  }

  if (isAustraliaRegion(labels, countryCode)) {
    return 'australia';
  }

  if (isInternationalEnglishRegion(labels, countryCode)) {
    return 'intlEnglish';
  }

  if (isUkRegion(labels, countryCode)) {
    return 'uk';
  }

  if (isEuropeRegion(labels, countryCode)) {
    return 'europe';
  }

  if (isDeprioritizedForeignLatin(labels, countryCode)) {
    return 'foreign';
  }

  return 'international';
}

function stripKnownRegionPrefix(title: string) {
  return title
    .replace(/^(?:usa|u\.?\s*s\.?\s*a?\.?|us|united states|american|america)\s*[\|｜¦:–\-]?\s*/i, '')
    .replace(/^(?:uk|united kingdom|british|britain)\s*[\|｜¦:–\-]?\s*/i, '')
    .trim();
}

function formatUsCategoryDisplay(
  parsedTitle: string,
  labels: string[],
  contentType: ProviderCategoryContentType,
) {
  const suffix = US_DEFAULT_DISPLAY_SUFFIX[contentType];
  const bareLabel = labels.some((label) => BARE_US_LABEL_PATTERN.test(label.trim()));
  const remainder = stripKnownRegionPrefix(parsedTitle);

  if (!remainder || bareLabel) {
    return `US ${suffix}`;
  }

  if (/^(series|movies|channels|entertainment)$/i.test(remainder)) {
    return `US ${titleCaseWords(remainder)}`;
  }

  return `US ${titleCaseWords(remainder)}`;
}

function formatInternationalEnglishDisplay(title: string) {
  const match = title.match(LITERAL_ENGLISH_LABEL_PATTERN);
  if (!match) {
    return title;
  }

  const remainder = match[1]?.trim();
  return remainder ? `International English ${titleCaseWords(remainder)}` : 'International English';
}

function formatUnitedKingdomDisplay(title: string, labels: string[]) {
  const normalized = title.trim();
  if (/^(uk|british|united kingdom|britain)$/i.test(normalized)) {
    return 'United Kingdom';
  }

  if (/^uk\b/i.test(normalized)) {
    return normalized.replace(/^uk\b/i, 'United Kingdom');
  }

  if (/^british\b/i.test(normalized)) {
    return normalized.replace(/^british\b/i, 'United Kingdom');
  }

  if (labels.some((label) => /^uk\b/i.test(label.trim()))) {
    return 'United Kingdom';
  }

  if (labels.some((label) => /^british\b/i.test(label.trim()))) {
    return 'United Kingdom';
  }

  return title;
}

function formatCanadaDisplay(title: string) {
  if (/^canada$/i.test(title.trim())) {
    return 'Canada';
  }

  return title;
}

function formatAustraliaDisplay(title: string) {
  if (/^australia$/i.test(title.trim())) {
    return 'Australia';
  }

  return title;
}

function resolveParsedTitle(input: CategoryRegionalInput) {
  const primaryLabel = input.rawName?.trim() || input.name.trim();
  return parseProviderTitlePrefix(primaryLabel).title.trim() || input.name.trim();
}

export function resolveCategoryDisplayName(input: CategoryRegionalInput): string {
  const labels = collectCategoryLabels(input);
  const contentType = input.contentType ?? 'live';
  let display = resolveParsedTitle(input);

  if (isUsRegion(labels, input.countryCode)) {
    display = formatUsCategoryDisplay(display, labels, contentType);
  } else if (isInternationalEnglishRegion(labels, input.countryCode)) {
    display = formatInternationalEnglishDisplay(display);
  } else if (isUkRegion(labels, input.countryCode)) {
    display = formatUnitedKingdomDisplay(display, labels);
  } else if (isCanadaRegion(labels, input.countryCode)) {
    display = formatCanadaDisplay(display);
  } else if (isAustraliaRegion(labels, input.countryCode)) {
    display = formatAustraliaDisplay(display);
  }

  return display;
}

export function buildCategoryRegionalProfile(
  input: CategoryRegionalInput,
  metrics?: CategoryRegionalSortMetrics,
): CategoryRegionalProfile {
  const labels = collectCategoryLabels(input);

  const parseStartedAt = metrics ? nowMs() : 0;
  const parsedLabels = parsedLabelsFor(labels);
  if (metrics) {
    metrics.titleParseMs = (metrics.titleParseMs ?? 0) + (nowMs() - parseStartedAt);
    metrics.titleParseCount = (metrics.titleParseCount ?? 0) + labels.length;
  }

  const scriptStartedAt = metrics ? nowMs() : 0;
  const scriptProfile = analyzeCategoryScriptProfile(labels);
  if (metrics) {
    metrics.scriptDetectMs = (metrics.scriptDetectMs ?? 0) + (nowMs() - scriptStartedAt);
    metrics.scriptDetectCount = (metrics.scriptDetectCount ?? 0) + 1;
  }

  const regionStartedAt = metrics ? nowMs() : 0;
  const regionGroup = resolveCategoryRegionGroupFromParsed(labels, scriptProfile, input.countryCode, parsedLabels);
  if (metrics) {
    metrics.regionClassifyMs = (metrics.regionClassifyMs ?? 0) + (nowMs() - regionStartedAt);
    metrics.regionClassifyCount = (metrics.regionClassifyCount ?? 0) + 1;
  }

  const sortPriority = CATEGORY_REGION_SORT_PRIORITY[regionGroup];
  const primary = parsedLabels[0];

  const displayStartedAt = metrics ? nowMs() : 0;
  let displayName = primary?.title.trim() || input.name.trim();
  if (regionGroup === 'us') {
    displayName = formatUsCategoryDisplay(displayName, labels, input.contentType ?? 'live');
  } else if (regionGroup === 'intlEnglish') {
    displayName = formatInternationalEnglishDisplay(displayName);
  } else if (regionGroup === 'uk') {
    displayName = formatUnitedKingdomDisplay(displayName, labels);
  } else if (regionGroup === 'canada') {
    displayName = formatCanadaDisplay(displayName);
  } else if (regionGroup === 'australia') {
    displayName = formatAustraliaDisplay(displayName);
  }
  if (metrics) {
    metrics.displayNameMs = (metrics.displayNameMs ?? 0) + (nowMs() - displayStartedAt);
  }

  const sortKeyStartedAt = metrics ? nowMs() : 0;
  const sortLabel = displayName.toLocaleLowerCase();
  if (metrics) {
    metrics.sortKeyMs = (metrics.sortKeyMs ?? 0) + (nowMs() - sortKeyStartedAt);
  }

  return {
    labels,
    scriptProfile,
    regionGroup,
    sortPriority,
    sortLabel,
    displayName,
  };
}

/**
 * Resolve only the numeric region priority. Movie/Series ranking does not
 * need the display-name/profile work used by category navigation, so keep
 * that hot path separate while sharing the exact group-resolution semantics.
 */
function resolveCategoryRegionPriority(input: CategoryRegionalInput): number {
  const labels = collectCategoryLabels(input);
  const scriptProfile = analyzeCategoryScriptProfile(labels);
  const regionGroup = resolveCategoryRegionGroup(labels, scriptProfile, input.countryCode);
  return CATEGORY_REGION_SORT_PRIORITY[regionGroup];
}

export function compareCategoryRegionalProfiles(left: CategoryRegionalProfile, right: CategoryRegionalProfile) {
  if (left.sortPriority !== right.sortPriority) {
    return left.sortPriority - right.sortPriority;
  }

  return compareSortLabels(left.sortLabel, right.sortLabel);
}

export function compareCategoryRegionalPriority(left: CategoryRegionalProfile, right: CategoryRegionalProfile) {
  return left.sortPriority - right.sortPriority;
}

/** Stable sort: region priority, optional alphabetical grouping, then original order. */
export function sortProviderCategoriesByRegion<T extends CategorySortLabel>(
  items: T[],
  options?: { contentType?: ProviderCategoryContentType; alphabetizeWithinGroup?: boolean; metrics?: CategoryRegionalSortMetrics },
): T[] {
  if (items.length <= 1) {
    return items;
  }

  const alphabetizeWithinGroup = options?.alphabetizeWithinGroup ?? true;
  const contentType = options?.contentType;
  const profileStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const ranked = items.map((item, index) => ({
    item,
    index,
    profile: buildCategoryRegionalProfile({
      name: item.name,
      rawName: item.rawName,
      countryCode: item.countryCode,
      contentType,
    }, options?.metrics),
  }));
  if (options?.metrics) {
    options.metrics.profileBuildMs += (typeof performance !== 'undefined' ? performance.now() : Date.now()) - profileStartedAt;
    options.metrics.profileBuildCount += ranked.length;
  }

  const hasPriorityVariation = ranked.some(
    ({ profile }, index, array) => index > 0 && profile.sortPriority !== array[0]?.profile.sortPriority,
  );

  if (!hasPriorityVariation && !alphabetizeWithinGroup) {
    return items;
  }

  if (!hasPriorityVariation && alphabetizeWithinGroup) {
    const hasAlphaVariation = ranked.some(
      ({ profile }, index, array) => index > 0 && profile.sortLabel !== array[0]?.profile.sortLabel,
    );

    if (!hasAlphaVariation) {
      return items;
    }
  }

  const sortStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  ranked.sort((left, right) => {
    if (options?.metrics) options.metrics.comparatorCalls += 1;
    const priorityDelta = compareCategoryRegionalPriority(left.profile, right.profile);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    if (alphabetizeWithinGroup) {
      const alphaDelta = compareSortLabels(left.profile.sortLabel, right.profile.sortLabel);
      if (alphaDelta !== 0) {
        return alphaDelta;
      }
    }

    return left.index - right.index;
  });
  if (options?.metrics) {
    options.metrics.actualSortMs += (typeof performance !== 'undefined' ? performance.now() : Date.now()) - sortStartedAt;
  }

  return ranked.map(({ item }) => item);
}

export function categoryRegionalSortRank(input: CategorySortLabel, contentType?: ProviderCategoryContentType) {
  // The numeric priority is independent of content type. Keep the argument
  // for the public API while avoiding full display-profile construction.
  void contentType;
  return resolveCategoryRegionPriority(input);
}

export function isUsAmericanLiveLabel(
  name: string,
  countryCode?: string,
  options?: { allowTitleParse?: boolean },
): boolean {
  const labels = [name.trim()].filter(Boolean);
  if (!labels.length) {
    return false;
  }

  if (isUsRegion(labels, countryCode)) {
    return true;
  }

  if (options?.allowTitleParse === false) {
    return false;
  }

  return parseProviderTitlePrefix(name).countryCode === 'US';
}

export function sortCategoriesForValidationExample(contentType: ProviderCategoryContentType = 'live') {
  const sampleLabels = [
    'US',
    'USA',
    'English',
    'English Series',
    'British',
    'UK',
    'Canada',
    'Australia',
    'Kids عربي',
    'رمضان',
    'Русский',
    '한국',
    '日本',
  ];

  return sortProviderCategoriesByRegion(
    sampleLabels.map((name, index) => ({ id: String(index + 1), name })),
    { contentType },
  );
}
