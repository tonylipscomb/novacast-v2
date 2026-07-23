import type { ProviderCategoryContentType } from './categoryNormalization.ts';

/** Lower numbers sort earlier. Smart categories use separate fixed ordering. */
export const CATEGORY_REGION_SORT_PRIORITY = {
  us: 0,
  canada: 1,
  australia: 2,
  intlEnglish: 3,
  uk: 4,
  europe: 5,
  international: 6,
  mixed: 7,
  foreign: 8,
} as const;

export type CategoryRegionGroup = keyof typeof CATEGORY_REGION_SORT_PRIORITY;

export const US_REGION_MARKERS =
  /\b(usa|u\.?\s*s\.?\s*a?\.?|united states|american|america)\b|\bUS\b|^US\s*[\|｜¦:–\-]/i;

export const CANADA_REGION_MARKERS = /\b(canada|canadian)\b|^CA\s*[\|｜¦:–\-]/i;

export const AUSTRALIA_REGION_MARKERS = /\b(australia|australian)\b|^AU\s*[\|｜¦:–\-]/i;

export const UK_REGION_MARKERS =
  /\b(united kingdom|british|britain|england|scotland|wales)\b|\bUK\b|^UK\s*[\|｜¦:–\-]/i;

export const EUROPE_REGION_MARKERS = /\b(europe|european|eu\b)/i;

export const INTERNATIONAL_ENGLISH_MARKERS =
  /\b(english|eng)\b/i;

export const DEPRIORITIZED_FOREIGN_LANGUAGE_MARKERS =
  /\b(hindi|tamil|telugu|malayalam|punjabi|bengali|marathi|gujarati|urdu|bollywood|kollywood|tollywood|sandalwood|bhojpuri|kannada|india|indian|desi|pakistan|bangla|sinhala|nepali|arabic|turkish|korean|japanese|chinese|mandarin|cantonese|thai|vietnamese|filipino|tagalog|indonesian|latino|latina|spanish|french|german|italian|portuguese|russian|polish|ukrainian|greek|hebrew|persian|farsi|afrikaans|swedish|dutch|romanian|hungarian|czech|bulgarian|serbian|croatian|slovak|finnish|norwegian|danish|kurdish|somali|amharic|swahili)\b/i;

export const DEPRIORITIZED_RELIGIOUS_MARKERS =
  /\b(islamic|islam|muslim|muslims|quran|koran|ramadan|ramadhan|eid|hijab|hijabi|halal|sunni|shia|shiah|shite|prophet|muhammad|mohammed|mohamed|nasheed|naat|sunnah|hadith|hajj|umrah|iftar|suhoor|suhur|taraweeh|tarawih|madrasa|madrassa|masjid|mosque|sufi|sufism|deen|dawah|dawa|zakat|salah|salat)\b/i;

export const EUROPE_COUNTRY_CODES = new Set([
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  'NO',
  'CH',
  'IS',
  'UA',
  'RS',
  'BA',
  'MK',
  'AL',
  'MD',
  'BY',
]);

export const FOREIGN_COUNTRY_CODES = new Set([
  'IN',
  'PK',
  'BD',
  'LK',
  'NP',
  'AF',
  'IR',
  'IQ',
  'SA',
  'AE',
  'EG',
  'TR',
  'KR',
  'JP',
  'CN',
  'TW',
  'HK',
  'TH',
  'VN',
  'PH',
  'ID',
  'MY',
  'MX',
  'BR',
  'AR',
  'CO',
  'CL',
  'PE',
  'RU',
  'IL',
  'ZA',
  'NG',
  'KE',
  'MA',
  'DZ',
  'TN',
]);

export const US_DEFAULT_DISPLAY_SUFFIX: Record<ProviderCategoryContentType, string> = {
  live: 'Entertainment',
  movie: 'Movies',
  series: 'Series',
};

export const US_CHANNELS_DISPLAY_SUFFIX = 'Channels';

/** Literal standalone English labels that should become International English. */
export const LITERAL_ENGLISH_LABEL_PATTERN = /^english(?:\s+(.*))?$/i;

export const BARE_US_LABEL_PATTERN = /^(?:usa|u\.?\s*s\.?\s*a?\.?|us|united states|american|america)$/i;

export const SMART_CATEGORY_DISPLAY_SKIP_PATTERN = /^smart:/;
