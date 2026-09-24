export type AnnouncementStatus = 'draft' | 'scheduled' | 'live' | 'expired' | 'disabled' | 'archived';
export type AnnouncementImportance = 'normal' | 'important' | 'critical';

export type AnnouncementRecord = {
  id: string;
  title: string;
  description: string;
  secondaryText: string | null;
  badge: string | null;
  kind: string;
  importance: AnnouncementImportance;
  status: 'draft' | 'published' | 'disabled' | 'archived';
  priority: number;
  startsAt: string | null;
  endsAt: string | null;
  publishedAt: string | null;
  disabledAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
  artworkUrl: string | null;
};

export type AnnouncementDraft = {
  title: string;
  description: string;
  secondaryText: string;
  badge: string;
  kind: string;
  importance: AnnouncementImportance;
  priority: string;
  startsAt: string;
  endsAt: string;
};

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_TITLE_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 500;
export const MAX_SECONDARY_LENGTH = 80;
export const MAX_BADGE_LENGTH = 32;
export const MIN_PRIORITY = 0;
export const MAX_PRIORITY = 100;
export const ANNOUNCEMENT_IMPORTANCES: AnnouncementImportance[] = ['normal', 'important', 'critical'];
export const ANNOUNCEMENT_FUNCTION = 'admin-novapulse-announcements';

export function announcementActionPath(action: string): string {
  return `${ANNOUNCEMENT_FUNCTION}?action=${encodeURIComponent(action)}`;
}

export function localInputToIso(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('invalid_schedule');
  return date.toISOString();
}

export function isoToLocalInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function validateSchedule(start: string, end: string): string | null {
  const startsAt = localInputToIso(start);
  const endsAt = localInputToIso(end);
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) return 'End time must be later than the start time.';
  return null;
}

export function deriveAnnouncementStatus(record: Pick<AnnouncementRecord, 'status' | 'deletedAt' | 'disabledAt' | 'startsAt' | 'endsAt'>, now = new Date()): AnnouncementStatus {
  if (record.deletedAt || record.status === 'archived') return 'archived';
  if (record.disabledAt || record.status === 'disabled') return 'disabled';
  if (record.status === 'draft') return 'draft';
  const nowMs = now.getTime();
  if (record.startsAt && Date.parse(record.startsAt) > nowMs) return 'scheduled';
  if (record.endsAt && Date.parse(record.endsAt) <= nowMs) return 'expired';
  return 'live';
}

export function announcementStatusLabel(status: AnnouncementStatus) {
  return status === 'live' ? 'Live' : status.charAt(0).toUpperCase() + status.slice(1);
}

export function validateAnnouncementDraft(draft: AnnouncementDraft, publish: boolean): string | null {
  if (draft.title.length > MAX_TITLE_LENGTH) return `Title must be ${MAX_TITLE_LENGTH} characters or fewer.`;
  if (draft.description.length > MAX_DESCRIPTION_LENGTH) return `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`;
  if (draft.secondaryText.length > MAX_SECONDARY_LENGTH) return `Subtitle must be ${MAX_SECONDARY_LENGTH} characters or fewer.`;
  if (draft.badge.length > MAX_BADGE_LENGTH) return `Badge must be ${MAX_BADGE_LENGTH} characters or fewer.`;
  const priority = Number(draft.priority);
  if (!Number.isInteger(priority) || priority < MIN_PRIORITY || priority > MAX_PRIORITY) return `Priority must be between ${MIN_PRIORITY} and ${MAX_PRIORITY}.`;
  const scheduleError = validateSchedule(draft.startsAt, draft.endsAt);
  if (scheduleError) return scheduleError;
  if (publish && (!draft.title.trim() || !draft.description.trim())) return 'Published announcements need a title and description.';
  return null;
}

export function validateArtworkFile(file: File): string | null {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Artwork must be a JPEG, PNG, or WebP image.';
  if (file.size > MAX_UPLOAD_BYTES) return 'Artwork must be 5 MB or smaller.';
  return null;
}

export function draftFromRecord(record: AnnouncementRecord): AnnouncementDraft {
  return {
    title: record.title ?? '',
    description: record.description ?? '',
    secondaryText: record.secondaryText ?? '',
    badge: record.badge ?? '',
    kind: record.kind ?? 'general',
    importance: record.importance ?? 'normal',
    priority: String(record.priority ?? 0),
    startsAt: isoToLocalInput(record.startsAt),
    endsAt: isoToLocalInput(record.endsAt),
  };
}

export const emptyAnnouncementDraft: AnnouncementDraft = {
  title: '', description: '', secondaryText: '', badge: '', kind: 'general', importance: 'normal', priority: '0', startsAt: '', endsAt: '',
};
