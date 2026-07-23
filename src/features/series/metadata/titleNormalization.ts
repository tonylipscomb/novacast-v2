const TRAILING_NOISE = /\s*[-:|▎▏│]+[\s|▎▏│:]*$/;
const TITLE_DELIMITERS = /[\s|｜¦┃·•–—\-▎▏│┆┊]+/;

/** Strip from display entirely — never show a country badge for these. */
const STRIP_ONLY_PREFIX_TOKENS = new Set([
  'EN',
  'ENG',
  'ES',
  'FR',
  'DE',
  'IT',
  'PT',
  'RU',
  'AR',
  'HI',
  'JP',
  'KO',
  'ZH',
  'MULTI',
  'DUAL',
  'DUB',
  'SUB',
  'SUBBED',
  'DUBBED',
  '4K',
  'UHD',
  'FHD',
  'HD',
  'SD',
  'HDR',
  'HEVC',
  'H264',
  'H265',
  'AF',
  'LA',
  'EU',
]);

const LANGUAGE_ONLY_CODES = new Set(['EN']);

const PREFIX_TOKEN_PATTERN = /^(?<token>[A-Za-z0-9]{2,8})\s*[\|｜¦:–\-▎▏│┆┊]\s*(?<rest>.+)$/i;
const BRACKET_PREFIX_PATTERN = /^\[(?<token>[^\]]+)\]\s*(?<rest>.+)$/i;
const SPACE_COUNTRY_PATTERN = /^(?<token>[A-Za-z]{2})\s+(?<rest>.{2,})$/;
const PROVIDER_COLON_LABEL = /^(?<label>[A-Za-z0-9][A-Za-z0-9 /]{1,24}):\s*(?<rest>.+)$/;
const NUMERIC_PIPE_PREFIX_PATTERN = /^(?<num>\d+)\s*[\|｜¦:–\-▎▏│┆┊]\s*(?<rest>.+)$/;
const LEADING_DELIMITER_PATTERN = /^[\s|｜¦┃·•–—\-▎▏│┆┊]+(?=\S)/;

export type ProviderTitlePrefix = {
  countryCode?: string;
  regionMarker?: 'multi';
  title: string;
};

function normalizeCountryCode(code: string) {
  const upper = code.trim().toUpperCase();
  if (upper === 'UK') {
    return 'GB';
  }

  return upper;
}

export function normalizeCountryCodeForDisplay(countryCode: string) {
  const normalized = normalizeCountryCode(countryCode);
  return normalized === 'GB' ? 'UK' : normalized;
}

export function isRecognizedCountryCode(code: string) {
  const normalized = normalizeCountryCode(code);
  if (!/^[A-Z]{2}$/.test(normalized) || LANGUAGE_ONLY_CODES.has(normalized)) {
    return false;
  }

  if (STRIP_ONLY_PREFIX_TOKENS.has(normalized)) {
    return false;
  }

  return true;
}

function shouldStripPrefixToken(token: string) {
  const upper = token.trim().toUpperCase();
  if (!upper) {
    return false;
  }

  if (STRIP_ONLY_PREFIX_TOKENS.has(upper)) {
    return true;
  }

  if (/^[A-Z]{2}$/.test(upper)) {
    return true;
  }

  if (/^(SPORTS|REPLAY|SPORT|NEWS|KIDS|MOVIE|MOVIES|LIVE|EVENT|PPV|UFC|FORMULA|MOTO|WORLD|REPLAYS)$/i.test(upper)) {
    return true;
  }

  // Generic short labels are only provider prefixes when they are written as
  // an uppercase code. Title-cased names such as "Batman: The Dark Knight"
  // are legitimate media titles and must remain intact.
  return upper.length <= 6 && token.trim() === upper;
}

export function isMultiRegionCategoryMarker(token: string) {
  return token.trim().toUpperCase() === 'MULTI';
}

function rememberCountryCode(current: string | undefined, token: string) {
  if (current || !isRecognizedCountryCode(token)) {
    return current;
  }

  return normalizeCountryCode(token);
}

function cleanDisplayTitle(title: string, fallback: string) {
  let cleaned = title.trim();
  for (let pass = 0; pass < 4; pass += 1) {
    cleaned = cleaned.replace(LEADING_DELIMITER_PATTERN, '').trim();
    const numericMatch = cleaned.match(NUMERIC_PIPE_PREFIX_PATTERN);
    if (numericMatch?.groups) {
      cleaned = numericMatch.groups.rest.trim();
      continue;
    }
    break;
  }

  cleaned = cleaned
    .replace(new RegExp(`^${TITLE_DELIMITERS.source}`), '')
    .replace(new RegExp(`${TITLE_DELIMITERS.source}$`), '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return cleaned || fallback.trim();
}

function stripLeadingTitleNoise(title: string) {
  let next = title.trim();
  if (!next) {
    return next;
  }

  if (LEADING_DELIMITER_PATTERN.test(next)) {
    return next.replace(LEADING_DELIMITER_PATTERN, '').trim();
  }

  const numericMatch = next.match(NUMERIC_PIPE_PREFIX_PATTERN);
  if (numericMatch?.groups) {
    return numericMatch.groups.rest.trim();
  }

  return next;
}

function stripNestedProviderPrefixes(raw: string): ProviderTitlePrefix {
  let title = raw.trim();
  let countryCode: string | undefined;
  let regionMarker: 'multi' | undefined;

  if (!title) {
    return { title: '' };
  }

  for (let depth = 0; depth < 8; depth += 1) {
    const strippedLeading = stripLeadingTitleNoise(title);
    if (strippedLeading !== title) {
      title = strippedLeading;
      continue;
    }

    const bracketMatch = title.match(BRACKET_PREFIX_PATTERN);
    if (bracketMatch?.groups) {
      const token = bracketMatch.groups.token.trim();
      if (shouldStripPrefixToken(token)) {
        if (isMultiRegionCategoryMarker(token)) {
          regionMarker = 'multi';
        } else {
          countryCode = rememberCountryCode(countryCode, token);
        }
        title = bracketMatch.groups.rest.trim();
        continue;
      }
    }

    const tokenMatch = title.match(PREFIX_TOKEN_PATTERN);
    if (tokenMatch?.groups) {
      const token = tokenMatch.groups.token.trim();
      if (shouldStripPrefixToken(token)) {
        if (isMultiRegionCategoryMarker(token)) {
          regionMarker = 'multi';
        } else {
          countryCode = rememberCountryCode(countryCode, token);
        }
        title = tokenMatch.groups.rest.trim();
        continue;
      }
      break;
    }

    const spaceMatch = title.match(SPACE_COUNTRY_PATTERN);
    if (spaceMatch?.groups) {
      const token = spaceMatch.groups.token.trim();
      if (shouldStripPrefixToken(token)) {
        if (isMultiRegionCategoryMarker(token)) {
          regionMarker = 'multi';
        } else {
          countryCode = rememberCountryCode(countryCode, token);
        }
        title = spaceMatch.groups.rest.trim();
        continue;
      }
    }

    const colonMatch = title.match(PROVIDER_COLON_LABEL);
    if (colonMatch?.groups) {
      const label = colonMatch.groups.label.trim();
      if (/\d/.test(label) || /^(UFC|PPV|LIVE|VOD|EVENT|REPLAY)/i.test(label)) {
        title = colonMatch.groups.rest.trim();
        continue;
      }
    }

    break;
  }

  return {
    countryCode,
    ...(regionMarker ? { regionMarker } : {}),
    title: cleanDisplayTitle(title, raw),
  };
}

export function parseProviderTitlePrefix(raw: string): ProviderTitlePrefix {
  return stripNestedProviderPrefixes(raw);
}

export function stripProviderStreamTitlePrefix(raw: string) {
  return parseProviderTitlePrefix(raw).title;
}

export function formatDisplayRating(rating?: string | number) {
  if (rating == null || rating === '') {
    return '';
  }

  const parsed = typeof rating === 'number' ? rating : Number.parseFloat(String(rating));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return '';
  }

  if (parsed > 10) {
    return parsed.toFixed(0);
  }

  const rounded = Math.round(parsed * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function displayStreamTitle(raw: string) {
  return stripProviderStreamTitlePrefix(raw);
}

/** Normalize media titles at ingest and playback launch. */
export function normalizeMediaTitle(raw: string) {
  return displayStreamTitle(raw);
}

export function parseProviderCategoryLabel(raw: string): ProviderTitlePrefix {
  return parseProviderTitlePrefix(raw);
}

export function displayCategoryName(raw: string) {
  return parseProviderCategoryLabel(raw).title;
}

export function formatMediaMetaLabel(input: {
  year?: number | string;
  rating?: string;
  genre?: string;
}) {
  const rating = formatDisplayRating(input.rating);

  if (input.year) {
    return String(input.year);
  }

  if (rating) {
    return `★ ${rating}`;
  }

  return input.genre ?? '';
}

export function countryCodeToFlagEmoji(countryCode: string) {
  if (!isRecognizedCountryCode(countryCode)) {
    return '';
  }

  const normalized = normalizeCountryCode(countryCode);
  if (!/^[A-Z]{2}$/.test(normalized)) {
    return '';
  }

  const base = 0x1f1e6;
  const chars = normalized.split('');
  const first = chars[0]?.charCodeAt(0);
  const second = chars[1]?.charCodeAt(0);
  if (!first || !second || first < 65 || first > 90 || second < 65 || second > 90) {
    return '';
  }

  return String.fromCodePoint(base + first - 65, base + second - 65);
}

const STRIP_PATTERNS: RegExp[] = [
  /\[[^\]]+\]/g,
  /\([^)]*\)/g,
  /\{[^}]*\}/g,
  /\b(4k|uhd|fhd|hd|sd|hdr|dolby|atmos|hevc|x264|x265|h\.?264|h\.?265)\b/gi,
  /\b(english|en|eng|multi|dual|dubbed|subbed)\b/gi,
  /\b(complete|collection|extended|unrated|remastered|director.?s cut)\b/gi,
];

export function normalizeProviderTitle(raw: string) {
  let title = raw.trim();
  if (!title) {
    return '';
  }

  for (const pattern of STRIP_PATTERNS) {
    title = title.replace(pattern, ' ');
  }

  title = title.replace(/\s{2,}/g, ' ').replace(TRAILING_NOISE, '').trim();
  return title;
}

export function extractYearFromTitle(title: string) {
  const parenMatch = title.match(/\((19|20)\d{2}\)/);
  if (parenMatch) {
    return Number.parseInt(parenMatch[0].slice(1, 5), 10);
  }

  const trailing = title.match(/\b(19|20)\d{2}\b/);
  if (trailing) {
    return Number.parseInt(trailing[0], 10);
  }

  return undefined;
}

export function buildTitleAliases(title: string) {
  const normalized = normalizeProviderTitle(title);
  const withoutArticle = normalized.replace(/^(the|a|an)\s+/i, '').trim();
  const aliases = new Set([title.trim(), normalized, withoutArticle]);
  return [...aliases].filter(Boolean);
}

export function fuzzyTitleScore(left: string, right: string) {
  const a = normalizeProviderTitle(left).toLowerCase();
  const b = normalizeProviderTitle(right).toLowerCase();
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  if (a.includes(b) || b.includes(a)) {
    return 0.85;
  }

  const aTokens = new Set(a.split(/\s+/).filter((token) => token.length > 2));
  const bTokens = new Set(b.split(/\s+/).filter((token) => token.length > 2));
  if (!aTokens.size || !bTokens.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(aTokens.size, bTokens.size);
}
