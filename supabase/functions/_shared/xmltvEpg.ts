import { isBlockedProviderHost, isBlockedIpv4, isBlockedIpv6 } from './providerHealth.ts';

export type EpgMode = 'provider' | 'custom' | 'provider_fallback_custom';
export const EPG_MODES: EpgMode[] = ['provider', 'custom', 'provider_fallback_custom'];
export type EpgFailure = 'dns_failure' | 'timeout' | 'http_403' | 'http_404' | 'http_5xx' | 'response_too_large' | 'compressed_response_too_large' | 'decompressed_response_too_large' | 'unsupported_compression' | 'invalid_xmltv' | 'empty_feed' | 'parse_failure' | 'unsafe_url';
export type EpgTestResult = {
  status: 'success' | EpgFailure;
  httpStatus: number | null;
  contentType: string | null;
  downloadBytes: number;
  compressedBytes: number;
  decompressedBytes: number;
  xmltvChannels: number;
  xmltvPrograms: number;
  invalidTimestamps: number;
  mappedChannels: number | null;
  unmatchedChannels: number | null;
  currentProgramCoverage: number | null;
  futureProgramCoverage: number | null;
  directIdMatches: number;
  exactNameMatches: number;
  normalizedNameMatches: number;
  ambiguousMatches: number;
  ambiguousChannels: number;
  unmatchedSamples: Array<{ channelName: string; epgChannelId: string | null }>;
  ambiguousSamples: Array<{ channelName: string; epgChannelId: string | null; candidates: string[] }>;
  providerChannelsScanned: number;
  usRelevantProviderChannels: number;
  nonUsProviderChannels: number;
  usMappedChannels: number;
  usUnmatchedChannels: number;
  usAmbiguousChannels: number;
  usMappingPercentage: number;
  canonicalNameMatches: number;
  aliasMatches: number;
  matchedSamples: Array<{ providerName: string; providerCanonical: string; xmltvDisplayName: string; xmltvCanonical: string; matchType: string }>;
  usUnmatchedSamples: Array<{ providerName: string; epgChannelId: string | null }>;
  usCurrentProgramCoverage: number;
  usFutureProgramCoverage: number;
  excludedByExplicitNonUsRegion: number;
  classifiedByUsCategory: number;
  classifiedByUsPrefix: number;
  excludedByNonUsPrefix?: number;
  excludedByNonUsCategory?: number;
  classifiedByUsNetworkHeuristic: number;
  mappingRecords?: EpgMappingRecord[];
  cachePayload?: EpgCachePayload;
  lastRefreshAt: string;
};
export type EpgTraceResult = {
  requestedHost: string;
  requestedPath: string;
  method: 'GET';
  redirectCount: number;
  finalHost: string | null;
  finalPath: string | null;
  status: number | null;
  contentType: string | null;
  contentLengthHeader: string | null;
  serverHeaderPresent: boolean;
  locationHeaderPresent: boolean;
} | { errorCategory: 'dns_failure' | 'timeout' | 'network_failure' | 'unsafe_url' };
export type EpgProbeResult = {
  status: 'reachable' | 'http_failure' | 'unsafe_url' | 'dns_failure' | 'timeout' | 'network_failure';
  httpStatus: number | null;
  contentType: string | null;
  contentLength: string | null;
  finalHost: string | null;
  finalPath: string | null;
  redirectCount: number;
  safeUrl: boolean;
  workerValidationRequired: true;
};

export const MAX_COMPRESSED_BYTES = 20 * 1024 * 1024;
export const MAX_DECOMPRESSED_BYTES = 128 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export function normalizeEpgMode(value: unknown): EpgMode {
  return EPG_MODES.includes(value as EpgMode) ? value as EpgMode : 'provider';
}

export function safeEpgUrl(value: unknown) {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 2_000) throw new Error('unsafe_url');
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error('unsafe_url'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || isBlockedProviderHost(url.hostname)) throw new Error('unsafe_url');
  return url;
}

async function validateDns(hostname: string) {
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':')) {
    if (isBlockedIpv4(hostname) || isBlockedIpv6(hostname)) throw new Error('unsafe_url');
    return;
  }
  try {
    const addresses = await Deno.resolveDns(hostname, 'A');
    if (addresses.some((address) => isBlockedIpv4(address) || isBlockedIpv6(address) || isBlockedProviderHost(address))) throw new Error('unsafe_url');
  } catch (error) {
    if (error instanceof Error && error.message === 'unsafe_url') throw error;
    throw new Error('dns_failure');
  }
}

class EpgSizeLimitError extends Error {
  constructor(message: 'compressed_response_too_large' | 'decompressed_response_too_large', readonly bytesRead: number) {
    super(message);
  }
}

export const MAX_XMLTV_TAG_CARRY_BYTES = 64 * 1024;

export type EpgLiveChannel = { name: string; epgChannelId: string | null; category: string | null; streamId?: string | null };
export type EpgChannelMetadata = { id: string; displayNames: string[] };
export type EpgProgramCoverage = { hasCurrent: boolean; hasFuture: boolean };
export type EpgProgramRecord = { channelId: string; startAt: string; stopAt: string; title: string; subtitle: string | null; description: string | null; category: string | null };
export type EpgMappingRecord = { providerStreamId: string; xmltvChannelId: string | null; matchType: string; matchConfidenceClass: 'proven' | 'ambiguous' | 'unmatched'; providerCanonical: string; xmltvCanonical: string | null };
export type EpgCachePayload = { channels: EpgChannelMetadata[]; programmes: EpgProgramRecord[]; mappings: EpgMappingRecord[] };
export type XmltvStreamSink = { onChannel?: (channel: EpgChannelMetadata) => void | Promise<void>; onProgramme?: (programme: EpgProgramRecord) => void | Promise<void> };

export const US_NETWORK_NAME_TERMS = [
  'ABC', 'CBS', 'NBC', 'FOX', 'ESPN', 'TNT', 'TBS', 'USA NETWORK', 'NFL', 'NBA', 'HBO', 'SHOWTIME', 'STARZ',
  'AMC', 'DISCOVERY', 'HISTORY', 'A&E', 'BRAVO', 'FX', 'FXX', 'SYFY', 'NICKELODEON', 'CARTOON NETWORK', 'DISNEY',
  'CNN', 'MSNBC', 'CNBC', 'FOX NEWS',
] as const;
export const EPG_CANONICAL_ALIASES: Readonly<Record<string, readonly string[]>> = { espn: ['espn'] };
export const EPG_PROVIDER_ID_ALIASES: Readonly<Record<string, readonly string[]>> = {};
const ISO_ALPHA_2_COUNTRY_CODES = new Set([
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ',
  'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW', 'CX', 'CY', 'CZ',
  'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET',
  'FI', 'FJ', 'FK', 'FM', 'FO', 'FR',
  'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY',
  'HK', 'HM', 'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT',
  'JE', 'JM', 'JO', 'JP',
  'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ',
  'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY',
  'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
  'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
  'OM',
  'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY',
  'QA',
  'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SY', 'SZ',
  'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ',
  'UA', 'UG', 'UM', 'US', 'UY', 'UZ',
  'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU',
  'WF', 'WS',
  'YE', 'YT',
  'ZA', 'ZM', 'ZW',
]);
const NON_US_REGION_NAMES = ['UNITED KINGDOM', 'NEW ZEALAND', 'ITALY', 'POLAND', 'GERMANY', 'CANADA', 'AUSTRALIA', 'FRANCE', 'SPAIN', 'NETHERLANDS', 'BELGIUM'] as const;
const EXPLICIT_REGION_PREFIX = /^\s*([A-Z]{2,3})\s*:/;

function readExplicitRegionPrefix(value: string) {
  return value.match(EXPLICIT_REGION_PREFIX)?.[1] ?? null;
}

function isGeographicPrefix(prefix: string | null) {
  return prefix != null && (ISO_ALPHA_2_COUNTRY_CODES.has(prefix) || prefix === 'UK' || prefix === 'USA');
}

function readXmltvAttribute(tag: string, name: string) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] ?? null;
}

type XmltvCounterState = {
  carry: string;
  channels: number;
  programs: number;
  invalidTimestamps: number;
  sawTv: boolean;
  sawTvEnd: boolean;
  channelIndex: Map<string, EpgChannelMetadata>;
  programCoverage: Map<string, EpgProgramCoverage>;
  activeChannelId: string | null;
  capturingDisplayName: boolean;
  displayNameText: string;
  activeProgram: { channelId: string; startTime: number | null; endTime: number | null; title: string; subtitle: string; description: string; category: string } | null;
  activeProgramField: 'title' | 'subtitle' | 'description' | 'category' | null;
  programmes: EpgProgramRecord[];
  retainProgrammes: boolean;
  onChannel?: (channel: EpgChannelMetadata) => void | Promise<void>;
  onProgramme?: (programme: EpgProgramRecord) => void | Promise<void>;
  now: number;
};

async function countXmltvTag(tag: string, state: XmltvCounterState) {
  if (/^<tv(?:\s|>)/i.test(tag)) state.sawTv = true;
  if (/^<\/tv\s*>/i.test(tag)) state.sawTvEnd = true;
  if (/^<channel\b/i.test(tag) && !/^<\//.test(tag)) {
    state.channels += 1;
    const id = readXmltvAttribute(tag, 'id')?.trim() ?? '';
    if (id) {
      state.channelIndex.set(id, { id, displayNames: state.channelIndex.get(id)?.displayNames ?? [] });
      state.activeChannelId = /\/\s*>$/.test(tag) ? null : id;
    }
  }
  if (/^<display-name(?:\s|>)/i.test(tag)) {
    state.capturingDisplayName = true;
    state.displayNameText = '';
  }
  if (/^<\/display-name\s*>/i.test(tag)) {
    const name = state.displayNameText.trim();
    if (name && state.activeChannelId) state.channelIndex.get(state.activeChannelId)?.displayNames.push(name);
    state.capturingDisplayName = false;
    state.displayNameText = '';
  }
  if (/^<\/channel\s*>/i.test(tag)) {
    const channel = state.activeChannelId ? state.channelIndex.get(state.activeChannelId) : null;
    if (channel) await state.onChannel?.(channel);
    state.activeChannelId = null;
  }
  if (/^<programme\b/i.test(tag) && !/^<\//.test(tag)) {
    state.programs += 1;
    const start = readXmltvAttribute(tag, 'start');
    const stop = readXmltvAttribute(tag, 'stop') ?? readXmltvAttribute(tag, 'end');
    const startTime = start ? parseXmltvTimestamp(start) : null;
    const endTime = stop ? parseXmltvTimestamp(stop) : null;
    state.activeProgram = { channelId: readXmltvAttribute(tag, 'channel')?.trim() ?? '', startTime, endTime, title: '', subtitle: '', description: '', category: '' };
    if (startTime == null || endTime == null) state.invalidTimestamps += 1;
    else {
      const channelId = readXmltvAttribute(tag, 'channel')?.trim();
      if (channelId) {
        const coverage = state.programCoverage.get(channelId) ?? { hasCurrent: false, hasFuture: false };
        coverage.hasCurrent ||= startTime <= state.now && endTime > state.now;
        coverage.hasFuture ||= startTime > state.now;
        state.programCoverage.set(channelId, coverage);
      }
    }
  }
  for (const field of ['title', 'sub-title', 'desc', 'category'] as const) {
    if (new RegExp(`^<${field}(?:\\s|>)`, 'i').test(tag)) {
      state.activeProgramField = field === 'sub-title' ? 'subtitle' : field === 'desc' ? 'description' : field;
      break;
    }
  }
  if (/^<\/(?:title|sub-title|desc|category)\s*>/i.test(tag)) state.activeProgramField = null;
  if (/^<\/programme\s*>/i.test(tag) && state.activeProgram) {
    const program = state.activeProgram;
    if (program.channelId && program.startTime != null && program.endTime != null && program.endTime > program.startTime && program.endTime >= state.now - 6 * 60 * 60 * 1000 && program.startTime <= state.now + 14 * 24 * 60 * 60 * 1000 && program.title.trim()) {
      const record = { channelId: program.channelId, startAt: new Date(program.startTime).toISOString(), stopAt: new Date(program.endTime).toISOString(), title: program.title.trim().slice(0, 500), subtitle: program.subtitle.trim().slice(0, 500) || null, description: program.description.trim().slice(0, 2000) || null, category: program.category.trim().slice(0, 200) || null };
      if (state.retainProgrammes) state.programmes.push(record);
      await state.onProgramme?.(record);
    }
    state.activeProgram = null;
    state.activeProgramField = null;
  }
}

async function consumeXmltvText(input: string, state: XmltvCounterState, final = false) {
  let text = state.carry + input;
  state.carry = '';
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('<', cursor);
    if (start < 0) {
      state.carry = text.slice(Math.max(cursor, text.length - MAX_XMLTV_TAG_CARRY_BYTES));
      break;
    }
    const end = text.indexOf('>', start + 1);
    if (end < 0) {
      state.carry = text.slice(start);
      if (state.carry.length > MAX_XMLTV_TAG_CARRY_BYTES) throw new Error('invalid_xmltv');
      break;
    }
    const plainText = text.slice(cursor, start);
    if (state.capturingDisplayName) state.displayNameText = (state.displayNameText + plainText).slice(0, MAX_XMLTV_TAG_CARRY_BYTES);
    if (state.activeProgram && state.activeProgramField) state.activeProgram[state.activeProgramField] = (state.activeProgram[state.activeProgramField] + plainText).slice(0, state.activeProgramField === 'description' ? 2000 : 500);
    await countXmltvTag(text.slice(start, end + 1), state);
    cursor = end + 1;
  }
  if (final && state.carry.trim()) throw new Error('invalid_xmltv');
}

export async function countXmltvStream(stream: ReadableStream<Uint8Array> | null, compressedBytes: { value: number } = { value: 0 }, now = Date.now(), options: boolean | { retainProgrammes?: boolean; onChannel?: (channel: EpgChannelMetadata) => void | Promise<void>; onProgramme?: (programme: EpgProgramRecord) => void | Promise<void> } = false) {
  if (!stream) throw new Error('invalid_xmltv');
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const streamOptions = typeof options === 'boolean' ? { retainProgrammes: options } : options;
  const state: XmltvCounterState = { carry: '', channels: 0, programs: 0, invalidTimestamps: 0, sawTv: false, sawTvEnd: false, channelIndex: new Map(), programCoverage: new Map(), activeChannelId: null, capturingDisplayName: false, displayNameText: '', activeProgram: null, activeProgramField: null, programmes: [], retainProgrammes: streamOptions.retainProgrammes ?? false, onChannel: streamOptions.onChannel, onProgramme: streamOptions.onProgramme, now };
  let decompressedBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      decompressedBytes += next.value.byteLength;
      if (decompressedBytes > MAX_DECOMPRESSED_BYTES) throw new EpgSizeLimitError('decompressed_response_too_large', decompressedBytes);
      await consumeXmltvText(decoder.decode(next.value, { stream: true }), state);
    }
    await consumeXmltvText(decoder.decode(), state, true);
  } finally {
    reader.releaseLock();
  }
  if (!state.sawTv || !state.sawTvEnd) throw new Error('invalid_xmltv');
  if (!state.channels || !state.programs) throw new Error('empty_feed');
  return { channels: state.channels, programs: state.programs, invalidTimestamps: state.invalidTimestamps, decompressedBytes, compressedBytes: compressedBytes.value, channelIndex: state.channelIndex, programCoverage: state.programCoverage, programmes: state.programmes };
}

export function normalizeEpgName(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[._-]+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

export function isUsRelevantEpgChannel(channel: EpgLiveChannel) {
  return classifyEpgChannel(channel).isUs;
}

export function classifyEpgChannel(channel: EpgLiveChannel) {
  const category = (channel.category ?? '').toLocaleUpperCase();
  const name = channel.name.toLocaleUpperCase();
  const categoryPrefix = readExplicitRegionPrefix(category);
  const namePrefix = readExplicitRegionPrefix(name);
  const categoryIsUs = /(^|[^A-Z])(US|USA|UNITED STATES)([^A-Z]|$)/.test(category);
  const categoryIsNonUs = (isGeographicPrefix(categoryPrefix) && categoryPrefix !== 'US' && categoryPrefix !== 'USA') || NON_US_REGION_NAMES.some((region) => new RegExp(`(^|[^A-Z])${region}(?=[^A-Z]|$)`).test(category));
  const prefixIsNonUs = isGeographicPrefix(namePrefix) && namePrefix !== 'US' && namePrefix !== 'USA';
  const prefixIsUs = namePrefix === 'US' || namePrefix === 'USA';
  const networkHeuristic = US_NETWORK_NAME_TERMS.some((term) => new RegExp(`(^|[^A-Z])${term.replace(/[+&]/g, '\\$&')}(?=[^A-Z]|$)`).test(name));
  if (categoryIsNonUs) return { isUs: false, reason: 'explicit_non_us_category' as const };
  if (prefixIsNonUs) return { isUs: false, reason: 'explicit_non_us_prefix' as const };
  if (categoryIsUs) return { isUs: true, reason: 'us_category' as const };
  if (prefixIsUs) return { isUs: true, reason: 'us_prefix' as const };
  if (networkHeuristic) return { isUs: true, reason: 'us_network_heuristic' as const };
  return { isUs: false, reason: 'no_us_signal' as const };
}

export function canonicalizeEpgName(value: string) {
  const normalized = value.normalize('NFKC').replace(/[\u1d00-\u1d7f]/gu, (character) => character === '\u1d18' ? 'P' : character);
  return normalized
    .replace(/^\s*(?:4k|hd|fhd|uhd|us|usa|prime)\s*:\s*/i, '')
    .replace(/\(\s*([WK][A-Z]{2,4})\s*\)/g, ' $1 ')
    .replace(/\(\s*(?:event|live[\s-]*event)\s*\)/gi, ' ')
    .replace(/\b(?:hd|fhd|uhd|4k|3840p|2160p|1080p|720p|event|live[\s-]*event|backup|raw)\b/gi, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/[&#=]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s()]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

function addIndexValue(index: Map<string, EpgChannelMetadata[]>, key: string, channel: EpgChannelMetadata) {
  if (!key) return;
  index.set(key, [...(index.get(key) ?? []), channel]);
}

function resolveQualityVariant(candidates: EpgChannelMetadata[], providerName: string) {
  if (candidates.length < 2) return candidates;
  const providerHasHd = /(^|[^A-Z])HD([^A-Z]|$)/i.test(providerName);
  const candidateHasHd = (candidate: EpgChannelMetadata) => /(^|[\s._-])HD($|[\s._-])/i.test(`${candidate.id} ${candidate.displayNames.join(' ')}`);
  const preferred = candidates.filter((candidate) => candidateHasHd(candidate) === providerHasHd);
  return preferred.length === 1 ? preferred : candidates;
}

export function mapEpgChannels(liveChannels: EpgLiveChannel[], channelIndex: Map<string, EpgChannelMetadata>, programCoverage: Map<string, EpgProgramCoverage>, options: { retainProvenance?: boolean } = {}) {
  const exactIds = new Map<string, EpgChannelMetadata>();
  const lowerIds = new Map<string, EpgChannelMetadata[]>();
  const exactNames = new Map<string, EpgChannelMetadata[]>();
  const normalizedNames = new Map<string, EpgChannelMetadata[]>();
  const canonicalNames = new Map<string, EpgChannelMetadata[]>();
  for (const channel of channelIndex.values()) {
    exactIds.set(channel.id, channel);
    const lower = channel.id.toLocaleLowerCase();
    lowerIds.set(lower, [...(lowerIds.get(lower) ?? []), channel]);
    for (const displayName of channel.displayNames) {
      addIndexValue(exactNames, displayName.trim(), channel);
      const normalized = normalizeEpgName(displayName);
      addIndexValue(normalizedNames, normalized, channel);
      addIndexValue(canonicalNames, canonicalizeEpgName(displayName), channel);
    }
  }

  let directIdMatches = 0;
  let exactNameMatches = 0;
  let normalizedNameMatches = 0;
  let ambiguousMatches = 0;
  let unmatchedChannels = 0;
  let current = 0;
  let future = 0;
  let canonicalNameMatches = 0;
  let aliasMatches = 0;
  let usRelevantProviderChannels = 0;
  let usMappedChannels = 0;
  let usUnmatchedChannels = 0;
  let usAmbiguousChannels = 0;
  let usCurrent = 0;
  let usFuture = 0;
  const currentCoverageIds = new Set<string>();
  const futureCoverageIds = new Set<string>();
  const usCurrentCoverageIds = new Set<string>();
  const usFutureCoverageIds = new Set<string>();
  let excludedByExplicitNonUsRegion = 0;
  let classifiedByUsCategory = 0;
  let classifiedByUsPrefix = 0;
  let excludedByNonUsPrefix = 0;
  let excludedByNonUsCategory = 0;
  let classifiedByUsNetworkHeuristic = 0;
  const unmatchedSamples: EpgTestResult['unmatchedSamples'] = [];
  const ambiguousSamples: EpgTestResult['ambiguousSamples'] = [];
  const matchedSamples: EpgTestResult['matchedSamples'] = [];
  const usUnmatchedSamples: EpgTestResult['usUnmatchedSamples'] = [];
  const mappingRecords: EpgMappingRecord[] | null = options.retainProvenance ? [] : null;
  for (const live of liveChannels) {
    const classification = classifyEpgChannel(live);
    const isUs = classification.isUs;
    if (classification.reason === 'explicit_non_us_category' || classification.reason === 'explicit_non_us_prefix') excludedByExplicitNonUsRegion += 1;
    if (classification.reason === 'explicit_non_us_prefix') excludedByNonUsPrefix += 1;
    if (classification.reason === 'explicit_non_us_category') excludedByNonUsCategory += 1;
    if (classification.reason === 'us_category') classifiedByUsCategory += 1;
    if (classification.reason === 'us_prefix') classifiedByUsPrefix += 1;
    if (classification.reason === 'us_network_heuristic') classifiedByUsNetworkHeuristic += 1;
    if (isUs) usRelevantProviderChannels += 1;
    const id = live.epgChannelId?.trim() || null;
    const name = live.name.trim();
    let candidates: EpgChannelMetadata[] = [];
    let matchKind: 'id' | 'name' | 'normalized' | 'canonical' | 'alias' | 'ambiguous' | 'none' = 'none';
    if (id && exactIds.has(id)) {
      candidates = [exactIds.get(id)!];
      matchKind = 'id';
    } else if (id && (lowerIds.get(id.toLocaleLowerCase()) ?? []).length === 1) {
      candidates = lowerIds.get(id.toLocaleLowerCase())!;
      matchKind = 'id';
    } else if ((exactNames.get(name) ?? []).length === 1) {
      candidates = exactNames.get(name)!;
      matchKind = 'name';
    } else if ((normalizedNames.get(normalizeEpgName(name)) ?? []).length === 1) {
      candidates = normalizedNames.get(normalizeEpgName(name))!;
      matchKind = 'normalized';
    } else if ((normalizedNames.get(normalizeEpgName(name)) ?? []).length > 1) {
      candidates = normalizedNames.get(normalizeEpgName(name))!;
      matchKind = 'ambiguous';
    } else if ((canonicalNames.get(canonicalizeEpgName(name)) ?? []).length > 0) {
      const canonicalCandidates = canonicalNames.get(canonicalizeEpgName(name))!;
      candidates = resolveQualityVariant(canonicalCandidates, name);
      matchKind = candidates.length === 1 ? 'canonical' : 'ambiguous';
    } else {
      const aliasTargets = EPG_CANONICAL_ALIASES[canonicalizeEpgName(name)] ?? [];
      const aliasCandidates = aliasTargets.flatMap((target) => canonicalNames.get(canonicalizeEpgName(target)) ?? []);
      const idAliasCandidates = id ? (EPG_PROVIDER_ID_ALIASES[id] ?? []).flatMap((target) => exactIds.get(target) ? [exactIds.get(target)!] : []) : [];
      const combined = [...new Map([...aliasCandidates, ...idAliasCandidates].map((candidate) => [candidate.id, candidate])).values()];
      if (combined.length === 1) {
        candidates = combined;
        matchKind = 'alias';
      } else if (combined.length > 1) {
        candidates = combined;
        matchKind = 'ambiguous';
      }
    }
    if (matchKind === 'ambiguous') {
      ambiguousMatches += 1;
      if (isUs) usAmbiguousChannels += 1;
      if (ambiguousSamples.length < 10) ambiguousSamples.push({ channelName: name, epgChannelId: id, candidates: candidates.map((candidate) => candidate.id).slice(0, 10) });
      continue;
    }
    if (!candidates.length) {
      unmatchedChannels += 1;
      if (isUs) {
        usUnmatchedChannels += 1;
        if (usUnmatchedSamples.length < 10) usUnmatchedSamples.push({ providerName: name, epgChannelId: id });
      }
      if (unmatchedSamples.length < 10) unmatchedSamples.push({ channelName: name, epgChannelId: id });
      continue;
    }
    if (matchKind === 'id') directIdMatches += 1;
    if (matchKind === 'name') exactNameMatches += 1;
    if (matchKind === 'normalized') normalizedNameMatches += 1;
    if (matchKind === 'canonical') canonicalNameMatches += 1;
    if (matchKind === 'alias') aliasMatches += 1;
    mappingRecords?.push({ providerStreamId: live.streamId ?? id ?? name, xmltvChannelId: candidates[0]!.id, matchType: matchKind === 'id' && id?.toLocaleLowerCase() === candidates[0]!.id.toLocaleLowerCase() && id !== candidates[0]!.id ? 'case_insensitive_id' : matchKind === 'id' ? 'direct_id' : matchKind === 'name' ? 'exact_name' : matchKind === 'normalized' ? 'normalized_name' : matchKind, matchConfidenceClass: 'proven', providerCanonical: canonicalizeEpgName(name), xmltvCanonical: canonicalizeEpgName(candidates[0]!.displayNames[0] ?? candidates[0]!.id) });
    if (isUs) {
      usMappedChannels += 1;
      if (matchKind === 'canonical') canonicalNameMatches += 0;
      if (matchedSamples.length < 10) matchedSamples.push({ providerName: name, providerCanonical: canonicalizeEpgName(name), xmltvDisplayName: candidates[0]!.displayNames[0] ?? candidates[0]!.id, xmltvCanonical: canonicalizeEpgName(candidates[0]!.displayNames[0] ?? candidates[0]!.id), matchType: matchKind });
    }
    const coverage = programCoverage.get(candidates[0]!.id);
    const targetId = candidates[0]!.id;
    if (coverage?.hasCurrent && !currentCoverageIds.has(targetId)) {
      currentCoverageIds.add(targetId);
      current += 1;
    }
    if (coverage?.hasFuture && !futureCoverageIds.has(targetId)) {
      futureCoverageIds.add(targetId);
      future += 1;
    }
    if (isUs) {
      if (coverage?.hasCurrent && !usCurrentCoverageIds.has(targetId)) {
        usCurrentCoverageIds.add(targetId);
        usCurrent += 1;
      }
      if (coverage?.hasFuture && !usFutureCoverageIds.has(targetId)) {
        usFutureCoverageIds.add(targetId);
        usFuture += 1;
      }
    }
  }
  const mappedChannels = directIdMatches + exactNameMatches + normalizedNameMatches + canonicalNameMatches + aliasMatches;
  return {
    mappedChannels,
    unmatchedChannels,
    ambiguousChannels: ambiguousMatches,
    directIdMatches,
    exactNameMatches,
    normalizedNameMatches,
    ambiguousMatches,
    currentProgramCoverage: mappedChannels ? current / mappedChannels : 0,
    futureProgramCoverage: mappedChannels ? future / mappedChannels : 0,
    unmatchedSamples,
    ambiguousSamples,
    providerChannelsScanned: liveChannels.length,
    usRelevantProviderChannels,
    nonUsProviderChannels: liveChannels.length - usRelevantProviderChannels,
    usMappedChannels,
    usUnmatchedChannels,
    usAmbiguousChannels,
    usMappingPercentage: usRelevantProviderChannels ? usMappedChannels / usRelevantProviderChannels : 0,
    canonicalNameMatches,
    aliasMatches,
    matchedSamples,
    usUnmatchedSamples,
    usCurrentProgramCoverage: usMappedChannels ? usCurrent / usMappedChannels : 0,
    usFutureProgramCoverage: usMappedChannels ? usFuture / usMappedChannels : 0,
    excludedByExplicitNonUsRegion,
    classifiedByUsCategory,
    classifiedByUsPrefix,
    excludedByNonUsPrefix,
    excludedByNonUsCategory,
    classifiedByUsNetworkHeuristic,
    mappingRecords: mappingRecords ?? undefined,
  };
}

function parseXmltvTimestamp(value: string) {
  const match = value.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, sign, tzHour, tzMinute] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
  if (sign) date.setUTCMinutes(date.getUTCMinutes() - (sign === '+' ? 1 : -1) * (Number(tzHour) * 60 + Number(tzMinute)));
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

export function parseXmltv(bytes: Uint8Array) {
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '');
  if (!/<tv(?:\s|>)/i.test(text) || !/<\/tv\s*>/i.test(text) || /<\/(?:channel|programme)\s*>[^<]*<\/(?:channel|programme)\s*>/i.test(text)) throw new Error('invalid_xmltv');
  const channels = [...text.matchAll(/<channel\b[^>]*\bid\s*=\s*["']([^"']+)["'][^>]*>/gi)].map((match) => match[1].trim()).filter(Boolean);
  const programs = [...text.matchAll(/<programme\b([^>]*)>/gi)];
  let invalidTimestamps = 0;
  for (const program of programs) {
    const start = program[1].match(/\bstart\s*=\s*["']([^"']+)["']/i)?.[1];
    const stop = program[1].match(/\b(?:stop|end)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!start || !stop || parseXmltvTimestamp(start) == null || parseXmltvTimestamp(stop) == null) invalidTimestamps += 1;
  }
  if (!channels.length || !programs.length) throw new Error('empty_feed');
  return { channels: channels.length, programs: programs.length, invalidTimestamps };
}

function classifyFetchError(error: unknown): EpgFailure {
  if (error instanceof Error && (EPG_FAILURES as readonly string[]).includes(error.message)) return error.message as EpgFailure;
  if (error instanceof DOMException && error.name === 'AbortError') return 'timeout';
  return 'dns_failure';
}
const EPG_FAILURES: EpgFailure[] = ['dns_failure', 'timeout', 'http_403', 'http_404', 'http_5xx', 'response_too_large', 'compressed_response_too_large', 'decompressed_response_too_large', 'unsupported_compression', 'invalid_xmltv', 'empty_feed', 'parse_failure', 'unsafe_url'];

export async function testXmltvFeed(input: { url: string; now?: Date; liveChannels?: EpgLiveChannel[]; mode?: 'diagnostic' | 'cache'; sink?: XmltvStreamSink }): Promise<EpgTestResult> {
  const lastRefreshAt = (input.now ?? new Date()).toISOString();
  let url: URL;
  try { url = safeEpgUrl(input.url); await validateDns(url.hostname); } catch (error) {
    return { status: classifyFetchError(error), httpStatus: null, contentType: null, downloadBytes: 0, compressedBytes: 0, decompressedBytes: 0, xmltvChannels: 0, xmltvPrograms: 0, invalidTimestamps: 0, mappedChannels: null, unmatchedChannels: null, currentProgramCoverage: null, futureProgramCoverage: null, directIdMatches: 0, exactNameMatches: 0, normalizedNameMatches: 0, ambiguousMatches: 0, ambiguousChannels: 0, unmatchedSamples: [], ambiguousSamples: [], providerChannelsScanned: 0, usRelevantProviderChannels: 0, nonUsProviderChannels: 0, usMappedChannels: 0, usUnmatchedChannels: 0, usAmbiguousChannels: 0, usMappingPercentage: 0, canonicalNameMatches: 0, aliasMatches: 0, matchedSamples: [], usUnmatchedSamples: [], usCurrentProgramCoverage: 0, usFutureProgramCoverage: 0, excludedByExplicitNonUsRegion: 0, classifiedByUsCategory: 0, classifiedByUsPrefix: 0, classifiedByUsNetworkHeuristic: 0, lastRefreshAt };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let responseStatus: number | null = null;
  let responseContent: string | null = null;
  let compressedBytes = 0;
  let decompressedBytes = 0;
  const compressedCounter = { value: 0 };
  try {
    const response = await fetch(url, { redirect: 'manual', signal: controller.signal });
    responseStatus = response.status;
    responseContent = response.headers.get('content-type')?.split(';')[0].trim().slice(0, 80) ?? null;
    const contentType = responseContent;
    if (response.status >= 300 && response.status < 400) throw new Error('unsafe_url');
    if (response.status === 403) throw new Error('http_403');
    if (response.status === 404) throw new Error('http_404');
    if (response.status >= 500) throw new Error('http_5xx');
    if (!response.ok) throw new Error('parse_failure');
    const encoding = (response.headers.get('content-encoding') ?? '').toLowerCase();
    const gzip = encoding === 'gzip' || url.pathname.toLowerCase().endsWith('.gz') || contentType === 'application/gzip';
    if (encoding && !['identity', 'gzip'].includes(encoding)) throw new Error('unsupported_compression');
    const contentLength = Number(response.headers.get('content-length'));
    if (gzip && Number.isFinite(contentLength) && contentLength > MAX_COMPRESSED_BYTES) throw new EpgSizeLimitError('compressed_response_too_large', 0);
    const countedBody = gzip && response.body
      ? response.body
        .pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            compressedCounter.value += chunk.byteLength;
            if (compressedCounter.value > MAX_COMPRESSED_BYTES) throw new EpgSizeLimitError('compressed_response_too_large', compressedCounter.value);
            controller.enqueue(chunk);
          },
        }))
        .pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>)
      : response.body;
    const retainCache = input.mode === 'cache';
    const parsed = await countXmltvStream(countedBody, compressedCounter, (input.now ?? new Date()).getTime(), { retainProgrammes: false, ...input.sink });
    compressedBytes = parsed.compressedBytes;
    decompressedBytes = parsed.decompressedBytes;
    const mapping = input.liveChannels ? mapEpgChannels(input.liveChannels, parsed.channelIndex, parsed.programCoverage, { retainProvenance: retainCache }) : null;
    return { status: 'success', httpStatus: response.status, contentType, downloadBytes: gzip ? compressedBytes : decompressedBytes, compressedBytes, decompressedBytes, xmltvChannels: parsed.channels, xmltvPrograms: parsed.programs, invalidTimestamps: parsed.invalidTimestamps, mappedChannels: mapping?.mappedChannels ?? null, unmatchedChannels: mapping?.unmatchedChannels ?? null, currentProgramCoverage: mapping?.currentProgramCoverage ?? null, futureProgramCoverage: mapping?.futureProgramCoverage ?? null, directIdMatches: mapping?.directIdMatches ?? 0, exactNameMatches: mapping?.exactNameMatches ?? 0, normalizedNameMatches: mapping?.normalizedNameMatches ?? 0, ambiguousMatches: mapping?.ambiguousMatches ?? 0, ambiguousChannels: mapping?.ambiguousChannels ?? 0, unmatchedSamples: mapping?.unmatchedSamples ?? [], ambiguousSamples: mapping?.ambiguousSamples ?? [], providerChannelsScanned: mapping?.providerChannelsScanned ?? 0, usRelevantProviderChannels: mapping?.usRelevantProviderChannels ?? 0, nonUsProviderChannels: mapping?.nonUsProviderChannels ?? 0, usMappedChannels: mapping?.usMappedChannels ?? 0, usUnmatchedChannels: mapping?.usUnmatchedChannels ?? 0, usAmbiguousChannels: mapping?.usAmbiguousChannels ?? 0, usMappingPercentage: mapping?.usMappingPercentage ?? 0, canonicalNameMatches: mapping?.canonicalNameMatches ?? 0, aliasMatches: mapping?.aliasMatches ?? 0, matchedSamples: mapping?.matchedSamples ?? [], usUnmatchedSamples: mapping?.usUnmatchedSamples ?? [], usCurrentProgramCoverage: mapping?.usCurrentProgramCoverage ?? 0, usFutureProgramCoverage: mapping?.usFutureProgramCoverage ?? 0, excludedByExplicitNonUsRegion: mapping?.excludedByExplicitNonUsRegion ?? 0, classifiedByUsCategory: mapping?.classifiedByUsCategory ?? 0, classifiedByUsPrefix: mapping?.classifiedByUsPrefix ?? 0, excludedByNonUsPrefix: mapping?.excludedByNonUsPrefix ?? 0, excludedByNonUsCategory: mapping?.excludedByNonUsCategory ?? 0, classifiedByUsNetworkHeuristic: mapping?.classifiedByUsNetworkHeuristic ?? 0, ...(retainCache ? { mappingRecords: mapping?.mappingRecords ?? [] } : {}), lastRefreshAt };
  } catch (error) {
    if (error instanceof EpgSizeLimitError) {
      if (error.message === 'compressed_response_too_large') compressedBytes = Math.max(compressedBytes, error.bytesRead);
      if (error.message === 'decompressed_response_too_large') decompressedBytes = Math.max(decompressedBytes, error.bytesRead);
    }
    if (compressedCounter.value > compressedBytes) compressedBytes = compressedCounter.value;
    const status = classifyFetchError(error);
    return { status, httpStatus: responseStatus, contentType: responseContent, downloadBytes: compressedBytes || decompressedBytes, compressedBytes, decompressedBytes, xmltvChannels: 0, xmltvPrograms: 0, invalidTimestamps: 0, mappedChannels: null, unmatchedChannels: null, currentProgramCoverage: null, futureProgramCoverage: null, directIdMatches: 0, exactNameMatches: 0, normalizedNameMatches: 0, ambiguousMatches: 0, ambiguousChannels: 0, unmatchedSamples: [], ambiguousSamples: [], providerChannelsScanned: 0, usRelevantProviderChannels: 0, nonUsProviderChannels: 0, usMappedChannels: 0, usUnmatchedChannels: 0, usAmbiguousChannels: 0, usMappingPercentage: 0, canonicalNameMatches: 0, aliasMatches: 0, matchedSamples: [], usUnmatchedSamples: [], usCurrentProgramCoverage: 0, usFutureProgramCoverage: 0, excludedByExplicitNonUsRegion: 0, classifiedByUsCategory: 0, classifiedByUsPrefix: 0, classifiedByUsNetworkHeuristic: 0, lastRefreshAt };
  } finally { clearTimeout(timer); }
}

export async function traceXmltvFeed(input: { url: string }): Promise<EpgTraceResult> {
  let url: URL;
  try {
    url = safeEpgUrl(input.url);
    await validateDns(url.hostname);
  } catch (error) {
    const category = classifyFetchError(error);
    return { errorCategory: category === 'dns_failure' ? 'dns_failure' : category === 'unsafe_url' ? 'unsafe_url' : 'network_failure' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal });
    let final: URL;
    try { final = new URL(response.url || url.toString()); } catch { final = url; }
    return {
      requestedHost: url.hostname,
      requestedPath: url.pathname,
      method: 'GET',
      redirectCount: 0,
      finalHost: final.hostname,
      finalPath: final.pathname,
      status: response.status,
      contentType: response.headers.get('content-type')?.split(';')[0].trim().slice(0, 80) ?? null,
      contentLengthHeader: response.headers.get('content-length')?.slice(0, 32) ?? null,
      serverHeaderPresent: response.headers.has('server'),
      locationHeaderPresent: response.headers.has('location'),
    };
  } catch (error) {
    const category = classifyFetchError(error);
    return { errorCategory: category === 'timeout' ? 'timeout' : category === 'unsafe_url' ? 'unsafe_url' : category === 'dns_failure' ? 'dns_failure' : 'network_failure' };
  } finally { clearTimeout(timer); }
}

const MAX_PROBE_REDIRECTS = 5;

function classifyProbeHttpStatus(status: number) {
  return status >= 200 && status < 400 ? 'reachable' as const : 'http_failure' as const;
}

export async function probeXmltvFeed(input: { url: string }): Promise<EpgProbeResult> {
  let current: URL;
  try {
    current = safeEpgUrl(input.url);
    await validateDns(current.hostname);
  } catch (error) {
    const category = classifyFetchError(error);
    return { status: category === 'unsafe_url' ? 'unsafe_url' : category === 'dns_failure' ? 'dns_failure' : 'network_failure', httpStatus: null, contentType: null, contentLength: null, finalHost: null, finalPath: null, redirectCount: 0, safeUrl: category !== 'unsafe_url', workerValidationRequired: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let redirectCount = 0;
  try {
    while (true) {
      const response = await fetch(current, { method: 'GET', redirect: 'manual', signal: controller.signal });
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        if (redirectCount >= MAX_PROBE_REDIRECTS) throw new Error('unsafe_url');
        let next: URL;
        try { next = new URL(location, current); } catch { throw new Error('unsafe_url'); }
        try { next = safeEpgUrl(next.toString()); await validateDns(next.hostname); } catch { throw new Error('unsafe_url'); }
        redirectCount += 1;
        await response.body?.cancel();
        current = next;
        continue;
      }
      await response.body?.cancel();
      return {
        status: classifyProbeHttpStatus(response.status),
        httpStatus: response.status,
        contentType: response.headers.get('content-type')?.split(';')[0].trim().slice(0, 80) ?? null,
        contentLength: response.headers.get('content-length')?.slice(0, 32) ?? null,
        finalHost: current.hostname,
        finalPath: current.pathname,
        redirectCount,
        safeUrl: true,
        workerValidationRequired: true,
      };
    }
  } catch (error) {
    const category = classifyFetchError(error);
    return { status: category === 'timeout' ? 'timeout' : category === 'unsafe_url' ? 'unsafe_url' : category === 'dns_failure' ? 'dns_failure' : 'network_failure', httpStatus: null, contentType: null, contentLength: null, finalHost: null, finalPath: null, redirectCount, safeUrl: category !== 'unsafe_url', workerValidationRequired: true };
  } finally { clearTimeout(timer); }
}
