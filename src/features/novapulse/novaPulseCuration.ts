import type { MovieSummary } from '../movies/movieTypes.ts';
import type { SeriesSummary } from '../media-browser/mediaTypes.ts';
import type { ContentPolicyId } from '../content-policy/ContentPolicyService.ts';
import { buildCategoryRegionalProfile } from '../providers/categoryRegionalPipeline.ts';

export type NovaPulseRegion = 'us' | 'foreign' | 'unknown';

export type NovaPulseCurationDiagnostics = {
  adultRejected: number;
  regionForeignRejected: number;
  usMatches: number;
  unknownRegion: number;
};

export type NovaPulseCurationDecision = {
  allowed: boolean;
  adult: boolean;
  region: NovaPulseRegion;
  reason: 'adult' | 'foreign-region' | 'allowed';
};

const US_COUNTRY_VALUES = new Set(['US', 'USA', 'UNITED STATES', 'UNITED STATES OF AMERICA']);
const FOREIGN_COUNTRY_VALUES = new Set([
  'AR', 'AU', 'AT', 'BE', 'BR', 'CA', 'CH', 'CN', 'CO', 'CZ', 'DE', 'DK', 'ES', 'FI', 'FR', 'GB', 'GR',
  'HK', 'HU', 'ID', 'IE', 'IL', 'IN', 'IT', 'JP', 'KR', 'MX', 'MY', 'NL', 'NO', 'NZ', 'PE', 'PH', 'PK',
  'PL', 'PT', 'RO', 'RU', 'SE', 'TH', 'TR', 'UA', 'VN', 'ZA',
]);

const ADULT_CATEGORY_PATTERNS = [
  /^adult(?:\s+(?:movies?|series?|content))?$/,
  /^for adults?$/,
  /^adults? only$/,
  /^xxx(?:\s+(?:movies?|series?|content))?$/,
  /^(?:18\+|18\s*plus|x[- ]rated)(?:\s+(?:movies?|series?|content))?$/,
  /^(?:porn|pornography|erotic|erotica)(?:\s+(?:movies?|series?|content))?$/,
];

function normalizeLabel(value?: string) {
  return (value ?? '')
    .trim()
    .toLocaleLowerCase()
    .replace(/^[\[\](){}]+|[\[\](){}]+$/g, '')
    .replace(/[|:_/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isNovaPulseAdultCategory(categoryName?: string) {
  const segments = (categoryName ?? '')
    .split(/[|:_/\\-]+/)
    .map((segment) => normalizeLabel(segment))
    .filter(Boolean);
  return segments.some((segment) => ADULT_CATEGORY_PATTERNS.some((pattern) => pattern.test(segment)));
}

function countryRegion(countryCode?: string): NovaPulseRegion | null {
  const normalized = countryCode?.trim().toUpperCase() ?? '';
  if (!normalized || /^\d+$/.test(normalized)) return null;
  if (US_COUNTRY_VALUES.has(normalized)) return 'us';
  if (FOREIGN_COUNTRY_VALUES.has(normalized)) return 'foreign';
  return null;
}

export function classifyNovaPulseRegion(input: {
  categoryName?: string;
  countryCode?: string;
  contentType: 'movie' | 'series' | 'live';
}) : NovaPulseRegion {
  const metadataRegion = countryRegion(input.countryCode);
  if (metadataRegion) return metadataRegion;
  const label = input.categoryName?.trim();
  if (!label) return 'unknown';
  const profile = buildCategoryRegionalProfile({
    name: label,
    rawName: label,
    countryCode: undefined,
    contentType: input.contentType,
    preferredRegion: 'US',
  });
  if (profile.regionGroup === 'us') return 'us';
  if (profile.regionGroup === 'foreign' || profile.regionGroup === 'europe' || profile.regionGroup === 'uk' || profile.regionGroup === 'canada' || profile.regionGroup === 'australia' || profile.regionGroup === 'intlEnglish') {
    return profile.regionGroup === 'intlEnglish' ? 'unknown' : 'foreign';
  }
  return 'unknown';
}

export function evaluateNovaPulseCuration(input: {
  categoryName?: string;
  countryCode?: string;
  contentType: 'movie' | 'series' | 'live';
  contentPolicy?: ContentPolicyId;
  explicitAdult?: boolean;
}): NovaPulseCurationDecision {
  const adult = input.explicitAdult === true || isNovaPulseAdultCategory(input.categoryName);
  if (adult) return { allowed: false, adult: true, region: 'unknown', reason: 'adult' };
  const region = classifyNovaPulseRegion(input);
  if ((input.contentPolicy ?? 'us_only') === 'us_only' && region === 'foreign') {
    return { allowed: false, adult: false, region, reason: 'foreign-region' };
  }
  return { allowed: true, adult: false, region, reason: 'allowed' };
}

function emptyDiagnostics(): NovaPulseCurationDiagnostics {
  return { adultRejected: 0, regionForeignRejected: 0, usMatches: 0, unknownRegion: 0 };
}

function recordDecision(diagnostics: NovaPulseCurationDiagnostics, decision: NovaPulseCurationDecision) {
  if (!decision.allowed && decision.adult) diagnostics.adultRejected += 1;
  if (!decision.allowed && decision.reason === 'foreign-region') diagnostics.regionForeignRejected += 1;
  if (decision.region === 'us') diagnostics.usMatches += 1;
  if (decision.region === 'unknown') diagnostics.unknownRegion += 1;
}

export function curateNovaPulseCatalog(
  movies: readonly MovieSummary[],
  series: readonly SeriesSummary[],
  contentPolicy: ContentPolicyId = 'us_only',
) {
  const diagnostics = emptyDiagnostics();
  const curate = <T extends { categoryName?: string; countryCode?: string }>(items: readonly T[], contentType: 'movie' | 'series') => {
    const safe: T[] = [];
    for (const item of items) {
      const decision = evaluateNovaPulseCuration({ categoryName: item.categoryName, countryCode: item.countryCode, contentType, contentPolicy });
      recordDecision(diagnostics, decision);
      if (decision.allowed) safe.push(item);
    }
    return safe.sort((left, right) => {
      const leftRegion = classifyNovaPulseRegion({ categoryName: left.categoryName, countryCode: left.countryCode, contentType });
      const rightRegion = classifyNovaPulseRegion({ categoryName: right.categoryName, countryCode: right.countryCode, contentType });
      return (leftRegion === 'us' ? 0 : 1) - (rightRegion === 'us' ? 0 : 1);
    });
  };
  return { movies: curate(movies, 'movie'), series: curate(series, 'series'), diagnostics };
}

export function curateNovaPulseLiveCategory(input: {
  categoryName?: string;
  countryCode?: string;
  contentPolicy?: ContentPolicyId;
}) {
  return evaluateNovaPulseCuration({ ...input, contentType: 'live' });
}
