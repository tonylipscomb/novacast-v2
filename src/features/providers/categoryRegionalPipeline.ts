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

const LETTER_PATTERN = /\p{L}/u;
const LATIN_LETTER_PATTERN = /\p{Script=Latin}/u;

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

export function buildCategoryRegionalProfile(input: CategoryRegionalInput): CategoryRegionalProfile {
  const labels = collectCategoryLabels(input);
  const scriptProfile = analyzeCategoryScriptProfile(labels);
  const regionGroup = resolveCategoryRegionGroup(labels, scriptProfile, input.countryCode);
  const sortPriority = CATEGORY_REGION_SORT_PRIORITY[regionGroup];
  const displayName = resolveCategoryDisplayName(input);
  const sortLabel = displayName.toLocaleLowerCase();

  return {
    labels,
    scriptProfile,
    regionGroup,
    sortPriority,
    sortLabel,
    displayName,
  };
}

export function compareCategoryRegionalProfiles(left: CategoryRegionalProfile, right: CategoryRegionalProfile) {
  if (left.sortPriority !== right.sortPriority) {
    return left.sortPriority - right.sortPriority;
  }

  return left.sortLabel.localeCompare(right.sortLabel, undefined, { sensitivity: 'base' });
}

export function compareCategoryRegionalPriority(left: CategoryRegionalProfile, right: CategoryRegionalProfile) {
  return left.sortPriority - right.sortPriority;
}

/** Stable sort: region priority, optional alphabetical grouping, then original order. */
export function sortProviderCategoriesByRegion<T extends CategorySortLabel>(
  items: T[],
  options?: { contentType?: ProviderCategoryContentType; alphabetizeWithinGroup?: boolean },
): T[] {
  if (items.length <= 1) {
    return items;
  }

  const alphabetizeWithinGroup = options?.alphabetizeWithinGroup ?? true;
  const contentType = options?.contentType;
  const ranked = items.map((item, index) => ({
    item,
    index,
    profile: buildCategoryRegionalProfile({
      name: item.name,
      rawName: item.rawName,
      countryCode: item.countryCode,
      contentType,
    }),
  }));

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

  ranked.sort((left, right) => {
    const priorityDelta = compareCategoryRegionalPriority(left.profile, right.profile);
    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    if (alphabetizeWithinGroup) {
      const alphaDelta = left.profile.sortLabel.localeCompare(right.profile.sortLabel, undefined, {
        sensitivity: 'base',
      });
      if (alphaDelta !== 0) {
        return alphaDelta;
      }
    }

    return left.index - right.index;
  });

  return ranked.map(({ item }) => item);
}

export function categoryRegionalSortRank(input: CategorySortLabel, contentType?: ProviderCategoryContentType) {
  return buildCategoryRegionalProfile({
    name: input.name,
    rawName: input.rawName,
    countryCode: input.countryCode,
    contentType,
  }).sortPriority;
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
