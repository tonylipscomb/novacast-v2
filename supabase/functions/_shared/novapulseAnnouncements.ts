export const NOVAPULSE_ANNOUNCEMENT_BUCKET = 'novapulse-announcement-artwork';
export const NOVAPULSE_ANNOUNCEMENT_MAX_ITEMS = 2;
export const NOVAPULSE_ANNOUNCEMENT_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const NOVAPULSE_ANNOUNCEMENT_MAX_LIST_ITEMS = 100;
export const NOVAPULSE_ANNOUNCEMENT_MAX_TITLE = 120;
export const NOVAPULSE_ANNOUNCEMENT_MAX_DESCRIPTION = 500;
export const NOVAPULSE_ANNOUNCEMENT_MAX_SECONDARY_TEXT = 80;
export const NOVAPULSE_ANNOUNCEMENT_MAX_BADGE = 32;

export const ANNOUNCEMENT_KINDS = ['general', 'update', 'service_alert', 'provider_alert'] as const;
export const ANNOUNCEMENT_IMPORTANCE = ['normal', 'important', 'critical'] as const;
export const ANNOUNCEMENT_STATUSES = ['draft', 'published', 'disabled', 'archived'] as const;

export type AnnouncementKind = typeof ANNOUNCEMENT_KINDS[number];
export type AnnouncementImportance = typeof ANNOUNCEMENT_IMPORTANCE[number];
export type AnnouncementStatus = typeof ANNOUNCEMENT_STATUSES[number];

export type AnnouncementRow = {
  id: string;
  title: string;
  description: string;
  secondary_text: string | null;
  badge: string | null;
  kind: AnnouncementKind;
  importance: AnnouncementImportance;
  artwork_path: string | null;
  status: AnnouncementStatus;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  published_at: string | null;
  disabled_at: string | null;
  deleted_at: string | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: string;
  updated_at: string;
  revision: number;
};

export const ANNOUNCEMENT_INTERNAL_SELECT = 'id,title,description,secondary_text,badge,kind,importance,artwork_path,status,priority,starts_at,ends_at,published_at,disabled_at,deleted_at,created_by,updated_by,created_at,updated_at,revision';
export const ANNOUNCEMENT_ADMIN_SELECT = 'id,title,description,secondary_text,badge,kind,importance,status,priority,starts_at,ends_at,published_at,disabled_at,deleted_at,created_at,updated_at,revision,artwork_path';
export const ANNOUNCEMENT_FEED_SELECT = 'id,revision,title,description,secondary_text,badge,kind,importance,priority,starts_at,ends_at,artwork_path,status,disabled_at,deleted_at,published_at,created_at';

export type AnnouncementInput = {
  title: string;
  description: string;
  secondaryText?: string | null;
  badge?: string | null;
  kind?: string;
  importance?: string;
  priority?: number;
  startsAt?: string | null;
  endsAt?: string | null;
};

export class AnnouncementValidationError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

function text(value: unknown, max: number, field: string, required = false) {
  if (value == null && !required) return null;
  if (typeof value !== 'string') throw new AnnouncementValidationError(`invalid_${field}`);
  const normalized = value.trim();
  if (required && !normalized) throw new AnnouncementValidationError(`invalid_${field}`);
  if (normalized.length > max) throw new AnnouncementValidationError(`${field}_too_long`);
  return normalized || null;
}

function timestamp(value: unknown, field: string) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new AnnouncementValidationError(`invalid_${field}`);
  }
  return new Date(value).toISOString();
}

export function validateAnnouncementInput(input: AnnouncementInput, options: { published?: boolean } = {}) {
  const title = text(input.title, NOVAPULSE_ANNOUNCEMENT_MAX_TITLE, 'title', options.published ?? true);
  const description = text(input.description, NOVAPULSE_ANNOUNCEMENT_MAX_DESCRIPTION, 'description', options.published ?? true);
  const secondaryText = text(input.secondaryText, NOVAPULSE_ANNOUNCEMENT_MAX_SECONDARY_TEXT, 'secondary_text');
  const badge = text(input.badge, NOVAPULSE_ANNOUNCEMENT_MAX_BADGE, 'badge');
  const kind = (input.kind ?? 'general') as AnnouncementKind;
  const importance = (input.importance ?? 'normal') as AnnouncementImportance;
  if (!ANNOUNCEMENT_KINDS.includes(kind)) throw new AnnouncementValidationError('invalid_kind');
  if (!ANNOUNCEMENT_IMPORTANCE.includes(importance)) throw new AnnouncementValidationError('invalid_importance');
  const priority = input.priority == null ? 0 : Number(input.priority);
  if (!Number.isInteger(priority) || priority < 0 || priority > 100) throw new AnnouncementValidationError('invalid_priority');
  const startsAt = timestamp(input.startsAt, 'starts_at');
  const endsAt = timestamp(input.endsAt, 'ends_at');
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new AnnouncementValidationError('ends_at_must_follow_starts_at');
  }
  return { title: title ?? '', description: description ?? '', secondary_text: secondaryText, badge, kind, importance, priority, starts_at: startsAt, ends_at: endsAt };
}

export function announcementIsEligible(row: Pick<AnnouncementRow, 'status' | 'deleted_at' | 'disabled_at' | 'title' | 'description' | 'starts_at' | 'ends_at'>, now = new Date()) {
  if (row.status !== 'published' || row.deleted_at || row.disabled_at || !row.title.trim() || !row.description.trim()) return false;
  const nowMs = now.getTime();
  return (!row.starts_at || Date.parse(row.starts_at) <= nowMs) && (!row.ends_at || Date.parse(row.ends_at) > nowMs);
}

const importanceRank: Record<AnnouncementImportance, number> = { critical: 3, important: 2, normal: 1 };

export function compareAnnouncements(a: Pick<AnnouncementRow, 'importance' | 'priority' | 'starts_at' | 'published_at' | 'created_at' | 'id'>, b: Pick<AnnouncementRow, 'importance' | 'priority' | 'starts_at' | 'published_at' | 'created_at' | 'id'>) {
  const importance = importanceRank[b.importance] - importanceRank[a.importance];
  if (importance) return importance;
  if (b.priority !== a.priority) return b.priority - a.priority;
  const aTime = Date.parse(a.starts_at ?? a.published_at ?? a.created_at);
  const bTime = Date.parse(b.starts_at ?? b.published_at ?? b.created_at);
  if (bTime !== aTime) return bTime - aTime;
  return a.id.localeCompare(b.id);
}

export function publicArtworkUrl(supabaseUrl: string, path: string | null) {
  return path ? `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/${NOVAPULSE_ANNOUNCEMENT_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}` : null;
}

export function toTvAnnouncement(row: AnnouncementRow, supabaseUrl: string) {
  return {
    id: row.id,
    revision: row.revision,
    title: row.title,
    description: row.description,
    secondaryText: row.secondary_text,
    badge: row.badge,
    kind: row.kind,
    importance: row.importance,
    priority: row.priority,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    artworkUrl: publicArtworkUrl(supabaseUrl, row.artwork_path),
  };
}

export type ArtworkValidation = { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; extension: 'jpg' | 'png' | 'webp'; width: number; height: number };

function u32be(bytes: Uint8Array, offset: number) { return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]; }
function u16be(bytes: Uint8Array, offset: number) { return (bytes[offset] << 8) + bytes[offset + 1]; }
function u24le(bytes: Uint8Array, offset: number) { return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16); }

function validateDeclaredMime(declaredMimeType: string | undefined, detectedMimeType: ArtworkValidation['mimeType']) {
  if (declaredMimeType && declaredMimeType !== detectedMimeType) throw new AnnouncementValidationError('artwork_mime_mismatch');
}

export function validateArtworkBytes(bytes: Uint8Array, declaredMimeType?: string): ArtworkValidation {
  if (bytes.byteLength > NOVAPULSE_ANNOUNCEMENT_MAX_UPLOAD_BYTES) throw new AnnouncementValidationError('artwork_too_large');
  if (bytes.length >= 24 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index]) && u32be(bytes, 12) === 0x49484452) {
    const width = u32be(bytes, 16); const height = u32be(bytes, 20);
    validateDeclaredMime(declaredMimeType, 'image/png');
    return validateArtworkDimensions({ mimeType: 'image/png', extension: 'png', width, height });
  }
  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset++; continue; }
      const marker = bytes[offset + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      const length = u16be(bytes, offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        validateDeclaredMime(declaredMimeType, 'image/jpeg');
        return validateArtworkDimensions({ mimeType: 'image/jpeg', extension: 'jpg', width: u16be(bytes, offset + 7), height: u16be(bytes, offset + 5) });
      }
      offset += 2 + length;
    }
  }
  if (bytes.length >= 30 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));
    if (chunk === 'VP8X') {
      validateDeclaredMime(declaredMimeType, 'image/webp');
      return validateArtworkDimensions({ mimeType: 'image/webp', extension: 'webp', width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) });
    }
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const bits = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0;
      validateDeclaredMime(declaredMimeType, 'image/webp');
      return validateArtworkDimensions({ mimeType: 'image/webp', extension: 'webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) });
    }
    if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      validateDeclaredMime(declaredMimeType, 'image/webp');
      return validateArtworkDimensions({ mimeType: 'image/webp', extension: 'webp', width: u16be(bytes, 26) & 0x3fff, height: u16be(bytes, 28) & 0x3fff });
    }
  }
  throw new AnnouncementValidationError('invalid_artwork_format');
}

function validateArtworkDimensions(value: ArtworkValidation): ArtworkValidation {
  if (!Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 1280 || value.height < 720 || value.width > 3840 || value.height > 2160) {
    throw new AnnouncementValidationError('invalid_artwork_dimensions');
  }
  return value;
}
