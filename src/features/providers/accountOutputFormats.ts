import { normalizeSingleExtension } from './playbackSourceDiagnostics.ts';
import type { ProviderAccountMetadata } from './providerModel.ts';

export const ACCOUNT_OUTPUT_FORMAT_DIAG = '[NovaCast Account Output Formats]';

export type AccountOutputFormatStage =
  | 'account-response'
  | 'normalized'
  | 'persisted'
  | 'hydrated-playback';

export type AccountOutputFormatValueKind = 'array' | 'string' | 'object' | 'missing' | 'other';

export type AccountOutputFormatInspection = {
  userInfoPresent: boolean;
  outputFormatKeyPresent: boolean;
  outputFormatValueKind: AccountOutputFormatValueKind;
  allowedOutputFormats: string[];
  preferredOutputFormat: string | null;
};

const OUTPUT_FORMAT_KEYS = [
  'allowed_output_formats',
  'allowed_output_format',
  'allowedOutputFormats',
  'output_formats',
  'outputFormats',
  'allowed_formats',
] as const;

const rememberedByProvider = new Map<string, ProviderAccountMetadata>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function extractXtreamUserInfoRecord(response: unknown): Record<string, unknown> {
  if (!isRecord(response)) {
    return {};
  }

  const raw = response.user_info ?? (response as Record<string, unknown>).userInfo ?? (response as Record<string, unknown>).info;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  return isRecord(raw) ? raw : {};
}

export function coerceOutputFormatList(value: unknown): string[] {
  if (value == null) {
    return [];
  }

  if (Array.isArray(value)) {
    return uniqueFormats(value.flatMap((item) => coerceOutputFormatList(item)));
  }

  if (typeof value === 'string') {
    return uniqueFormats(
      value
        .split(/[,\s|]+/)
        .map((item) => normalizeSingleExtension(item))
        .filter((item): item is string => Boolean(item)),
    );
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const normalized = normalizeSingleExtension(String(value));
    return normalized ? [normalized] : [];
  }

  if (isRecord(value)) {
    return uniqueFormats(Object.values(value).flatMap((item) => coerceOutputFormatList(item)));
  }

  return [];
}

export function inspectAccountOutputFormats(response: unknown): AccountOutputFormatInspection {
  const userInfo = extractXtreamUserInfoRecord(response);
  const userInfoPresent =
    Object.keys(userInfo).length > 0 ||
    (isRecord(response) && (response.user_info != null || response.userInfo != null || response.info != null));
  const found = findOutputFormatField(userInfo) ?? (isRecord(response) ? findOutputFormatField(response) : null);
  const allowedOutputFormats = found ? coerceOutputFormatList(found.value) : [];
  const preferredOutputFormat = preferOutputFormat(allowedOutputFormats);

  return {
    userInfoPresent,
    outputFormatKeyPresent: Boolean(found),
    outputFormatValueKind: found?.kind ?? 'missing',
    allowedOutputFormats,
    preferredOutputFormat,
  };
}

export function preferOutputFormat(formats: readonly string[]): string | null {
  if (formats.includes('m3u8')) {
    return 'm3u8';
  }
  if (formats.includes('ts')) {
    return 'ts';
  }
  return formats[0] ?? null;
}

export function rememberAccountOutputFormats(providerId: string | null | undefined, account: ProviderAccountMetadata | null) {
  const key = String(providerId ?? '').trim();
  if (!key || !account) {
    return;
  }
  rememberedByProvider.set(key, {
    preferredOutputFormat: account.preferredOutputFormat ?? null,
    allowedOutputFormats: account.allowedOutputFormats ?? [],
    status: account.status,
    expiresAt: account.expiresAt,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  });
}

export function getRememberedAccountOutputFormats(providerId: string | null | undefined): ProviderAccountMetadata | null {
  const key = String(providerId ?? '').trim();
  if (!key) {
    return null;
  }
  return rememberedByProvider.get(key) ?? null;
}

export function resetRememberedAccountOutputFormats() {
  rememberedByProvider.clear();
}

export function mergeAccountOutputFormats(
  ...candidates: Array<ProviderAccountMetadata | null | undefined>
): ProviderAccountMetadata | null {
  for (const candidate of candidates) {
    const allowed = (candidate?.allowedOutputFormats ?? []).map((item) => normalizeSingleExtension(item)).filter((item): item is string => Boolean(item));
    const preferred = normalizeSingleExtension(candidate?.preferredOutputFormat) ?? preferOutputFormat(allowed);
    if (allowed.length > 0 || preferred) {
      return {
        ...candidate,
        allowedOutputFormats: allowed,
        preferredOutputFormat: preferred,
      };
    }
  }
  return candidates.find((item) => item != null) ?? null;
}

export function logAccountOutputFormatPropagation(input: {
  stage: AccountOutputFormatStage;
  userInfoPresent?: boolean;
  outputFormatKeyPresent?: boolean;
  outputFormatValueKind?: AccountOutputFormatValueKind;
  allowedOutputFormats?: readonly string[] | null;
  preferredOutputFormat?: string | null;
}) {
  const allowedOutputFormats = (input.allowedOutputFormats ?? [])
    .map((item) => normalizeSingleExtension(item))
    .filter((item): item is string => Boolean(item));

  console.info(ACCOUNT_OUTPUT_FORMAT_DIAG, {
    stage: input.stage,
    userInfoPresent: input.userInfoPresent ?? false,
    outputFormatKeyPresent: input.outputFormatKeyPresent ?? allowedOutputFormats.length > 0,
    outputFormatValueKind: input.outputFormatValueKind ?? (allowedOutputFormats.length > 0 ? 'array' : 'missing'),
    allowedOutputFormatCount: allowedOutputFormats.length,
    preferredOutputFormat: input.preferredOutputFormat ?? preferOutputFormat(allowedOutputFormats),
    retainedOutputFormats: allowedOutputFormats,
  });
}

function findOutputFormatField(record: Record<string, unknown>): { value: unknown; kind: AccountOutputFormatValueKind } | null {
  const keys = Object.keys(record);
  const matchedKey = OUTPUT_FORMAT_KEYS.find((key) => key in record)
    ?? keys.find((key) => /allowed[_]?output[_]?format/i.test(key) || /^(output_formats|outputFormats|allowed_formats)$/i.test(key));
  if (!matchedKey) {
    return null;
  }
  return { value: record[matchedKey], kind: valueKind(record[matchedKey]) };
}

function valueKind(value: unknown): AccountOutputFormatValueKind {
  if (value == null) {
    return 'missing';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  if (typeof value === 'string') {
    return 'string';
  }
  if (typeof value === 'object') {
    return 'object';
  }
  return 'other';
}

function uniqueFormats(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }
  return result.slice(0, 12);
}
