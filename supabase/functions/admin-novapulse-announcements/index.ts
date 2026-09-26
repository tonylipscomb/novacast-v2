import { adminJsonResponse, adminOptionsResponse } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';
import {
  ANNOUNCEMENT_ADMIN_SELECT,
  ANNOUNCEMENT_INTERNAL_SELECT,
  NOVAPULSE_ANNOUNCEMENT_MAX_LIST_ITEMS,
  NOVAPULSE_ANNOUNCEMENT_BUCKET,
  AnnouncementValidationError,
  publicArtworkUrl,
  validateAnnouncementInput,
  validateArtworkBytes,
  type AnnouncementRow,
} from '../_shared/novapulseAnnouncements.ts';

const MAX_JSON_BYTES = 128 * 1024;
const MAX_MULTIPART_BYTES = 6 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorResponse(request: Request, error: unknown) {
  const code = error instanceof Error ? error.message : 'admin_request_failed';
  if (code === 'admin_unauthorized') return adminJsonResponse(request, { errorCategory: code }, 401);
  if (code === 'admin_forbidden') return adminJsonResponse(request, { errorCategory: code }, 403);
  if (code === 'announcement_not_found') return adminJsonResponse(request, { errorCategory: code }, 404);
  if (code === 'method_not_allowed') return adminJsonResponse(request, { errorCategory: code }, 405);
  if (code === 'announcement_revision_conflict') return adminJsonResponse(request, { errorCategory: code, currentRevision: (error as Error & { currentRevision?: number }).currentRevision ?? null }, 409);
  if (error instanceof AnnouncementValidationError) return adminJsonResponse(request, { errorCategory: error.code }, 400);
  if (code === 'request_too_large') return adminJsonResponse(request, { errorCategory: code }, 413);
  console.error('[NovaPulse Announcements Admin]', JSON.stringify({ errorCategory: code }));
  return adminJsonResponse(request, { errorCategory: 'admin_request_failed' }, 500);
}

async function boundedJson(request: Request) {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_JSON_BYTES) throw new Error('request_too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) throw new Error('request_too_large');
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch {
    throw new AnnouncementValidationError('invalid_json');
  }
}

function idOf(value: unknown) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!UUID_RE.test(id)) throw new AnnouncementValidationError('invalid_id');
  return id;
}

function revisionOf(value: unknown) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) throw new AnnouncementValidationError('invalid_revision');
  return revision;
}

function stringValue(value: unknown, fallback = '', field = 'field') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new AnnouncementValidationError(`invalid_${field}`);
  return value;
}
function nullableStringValue(value: unknown, fallback: string | null = null, field = 'field') {
  if (value === undefined) return fallback;
  if (value !== null && typeof value !== 'string') throw new AnnouncementValidationError(`invalid_${field}`);
  return value;
}
function numberValue(value: unknown, fallback: number, field = 'field') {
  if (value === undefined) return fallback;
  if (typeof value !== 'number') throw new AnnouncementValidationError(`invalid_${field}`);
  return value;
}

function publicAdminRow(row: AnnouncementRow, url: string) {
  return {
    id: row.id, title: row.title, description: row.description, secondaryText: row.secondary_text,
    badge: row.badge, kind: row.kind, importance: row.importance, status: row.status,
    priority: row.priority, startsAt: row.starts_at, endsAt: row.ends_at, publishedAt: row.published_at,
    disabledAt: row.disabled_at, deletedAt: row.deleted_at, createdAt: row.created_at,
    updatedAt: row.updated_at, revision: row.revision, artworkUrl: publicArtworkUrl(url, row.artwork_path),
  };
}

async function getRow(client: Awaited<ReturnType<typeof requireAdmin>>['client'], id: string) {
  const result = await client.from('novapulse_announcements').select(ANNOUNCEMENT_INTERNAL_SELECT).eq('id', id).maybeSingle();
  if (result.error) throw new Error('announcement_query_failed');
  if (!result.data) throw new Error('announcement_not_found');
  return result.data as AnnouncementRow;
}

async function requireRevision(client: Awaited<ReturnType<typeof requireAdmin>>['client'], id: string, revision: number) {
  const row = await getRow(client, id);
  if (row.revision !== revision) {
    const error = new Error('announcement_revision_conflict') as Error & { currentRevision?: number };
    error.currentRevision = row.revision;
    throw error;
  }
  return row;
}

async function removeObject(client: Awaited<ReturnType<typeof requireAdmin>>['client'], path: string | null) {
  if (!path) return;
  const result = await client.storage.from(NOVAPULSE_ANNOUNCEMENT_BUCKET).remove([path]);
  if (result.error) console.warn('[NovaPulse Announcements Admin]', JSON.stringify({ event: 'artwork_cleanup_failed' }));
}

async function updateWithRevision(client: Awaited<ReturnType<typeof requireAdmin>>['client'], id: string, revision: number, patch: Record<string, unknown>) {
  const row = await requireRevision(client, id, revision);
  const result = await client.from('novapulse_announcements').update(patch).eq('id', id).eq('revision', revision).select(ANNOUNCEMENT_INTERNAL_SELECT).maybeSingle();
  if (result.error) throw new Error('announcement_update_failed');
  if (!result.data) {
    const error = new Error('announcement_revision_conflict') as Error & { currentRevision?: number };
    error.currentRevision = (await getRow(client, id)).revision;
    throw error;
  }
  return { before: row, after: result.data as AnnouncementRow };
}

async function handleUpload(request: Request, client: Awaited<ReturnType<typeof requireAdmin>>['client'], userId: string, url: string) {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared <= 0 || declared > MAX_MULTIPART_BYTES) throw new Error('request_too_large');
  const form = await request.formData();
  const id = idOf(form.get('id'));
  const revision = revisionOf(form.get('revision'));
  const file = form.get('file');
  if (!(file instanceof File)) throw new AnnouncementValidationError('artwork_required');
  if (file.size > 5 * 1024 * 1024) throw new Error('request_too_large');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const artwork = validateArtworkBytes(bytes, file.type || undefined);
  const row = await requireRevision(client, id, revision);
  const path = `announcements/${id}/${revision + 1}-${crypto.randomUUID()}.${artwork.extension}`;
  const uploaded = await client.storage.from(NOVAPULSE_ANNOUNCEMENT_BUCKET).upload(path, new Blob([bytes], { type: artwork.mimeType }), { contentType: artwork.mimeType, upsert: false });
  if (uploaded.error) throw new Error('artwork_upload_failed');
  try {
    const result = await client.from('novapulse_announcements').update({ artwork_path: path, updated_by: userId }).eq('id', id).eq('revision', revision).select(ANNOUNCEMENT_INTERNAL_SELECT).maybeSingle();
    if (result.error || !result.data) {
      const conflict = result.error ? new Error('announcement_update_failed') : new Error('announcement_revision_conflict');
      if (conflict.message === 'announcement_revision_conflict') (conflict as Error & { currentRevision?: number }).currentRevision = (await getRow(client, id)).revision;
      throw conflict;
    }
    await removeObject(client, row.artwork_path);
    return publicAdminRow(result.data as AnnouncementRow, url);
  } catch (error) {
    await removeObject(client, path);
    throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return adminOptionsResponse(request);
  try {
    const { client, user } = await requireAdmin(request, { distinguishForbidden: true });
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const action = new URL(request.url).searchParams.get('action')?.trim() || (request.method === 'GET' ? 'list' : '');
    if (action === 'upload_artwork') {
      if (request.method !== 'POST') throw new Error('method_not_allowed');
      return adminJsonResponse(request, { item: await handleUpload(request, client, user.id, url) });
    }
    if (request.method === 'GET' && action === 'list') {
      const params = new URL(request.url).searchParams;
      const limit = Math.min(Math.max(Number(params.get('limit') ?? 50) || 50, 1), NOVAPULSE_ANNOUNCEMENT_MAX_LIST_ITEMS);
      const page = Math.min(Math.max(Number(params.get('page') ?? 0) || 0, 0), 1000);
      const result = await client.from('novapulse_announcements').select(ANNOUNCEMENT_ADMIN_SELECT).order('updated_at', { ascending: false }).range(page * limit, page * limit + limit - 1);
      if (result.error) throw new Error('announcement_query_failed');
      return adminJsonResponse(request, { items: (result.data ?? []).map((row) => publicAdminRow(row as AnnouncementRow, url)), page, limit, hasMore: (result.data ?? []).length === limit });
    }
    if (request.method === 'GET' && action === 'get') {
      const row = await getRow(client, idOf(new URL(request.url).searchParams.get('id')));
      return adminJsonResponse(request, { item: publicAdminRow(row, url) });
    }
    if (request.method !== 'POST' || !['create_draft', 'update', 'publish', 'disable', 'archive', 'delete_artwork'].includes(action)) throw new Error('method_not_allowed');
    const body = await boundedJson(request);
    if (!body) throw new AnnouncementValidationError('invalid_request');
    if (action === 'create_draft') {
      const input = validateAnnouncementInput({
        title: stringValue(body.title, '', 'title'),
        description: stringValue(body.description, '', 'description'),
        secondaryText: nullableStringValue(body.secondaryText, null, 'secondaryText'),
        badge: nullableStringValue(body.badge, null, 'badge'),
        kind: stringValue(body.kind, 'general', 'kind'),
        importance: stringValue(body.importance, 'normal', 'importance'),
        priority: numberValue(body.priority, 0, 'priority'),
        startsAt: nullableStringValue(body.startsAt, null, 'startsAt'),
        endsAt: nullableStringValue(body.endsAt, null, 'endsAt'),
      }, { published: false });
      const result = await client.from('novapulse_announcements').insert({ ...input, status: 'draft', created_by: user.id, updated_by: user.id }).select(ANNOUNCEMENT_INTERNAL_SELECT).single();
      if (result.error) throw new Error('announcement_create_failed');
      return adminJsonResponse(request, { item: publicAdminRow(result.data as AnnouncementRow, url) }, 201);
    }
    const id = idOf(body.id);
    const revision = revisionOf(body.revision);
    if (action === 'update') {
      const current = await requireRevision(client, id, revision);
      const input = validateAnnouncementInput({
        title: stringValue(body.title, current.title, 'title'), description: stringValue(body.description, current.description, 'description'),
        secondaryText: nullableStringValue(body.secondaryText, current.secondary_text, 'secondaryText'), badge: nullableStringValue(body.badge, current.badge, 'badge'),
        kind: stringValue(body.kind, current.kind, 'kind'), importance: stringValue(body.importance, current.importance, 'importance'),
        priority: numberValue(body.priority, current.priority, 'priority'), startsAt: nullableStringValue(body.startsAt, current.starts_at, 'startsAt'), endsAt: nullableStringValue(body.endsAt, current.ends_at, 'endsAt'),
      }, { published: current.status === 'published' });
      const result = await updateWithRevision(client, id, revision, { ...input, updated_by: user.id });
      return adminJsonResponse(request, { item: publicAdminRow(result.after, url) });
    }
    if (action === 'publish') {
      const current = await requireRevision(client, id, revision);
      validateAnnouncementInput({
        title: current.title,
        description: current.description,
        secondaryText: current.secondary_text,
        badge: current.badge,
        kind: current.kind,
        importance: current.importance,
        priority: current.priority,
        startsAt: current.starts_at,
        endsAt: current.ends_at,
      }, { published: true });
      const result = await updateWithRevision(client, id, revision, { status: 'published', published_at: current.published_at ?? new Date().toISOString(), disabled_at: null, deleted_at: null, updated_by: user.id });
      return adminJsonResponse(request, { item: publicAdminRow(result.after, url) });
    }
    if (action === 'disable') {
      const result = await updateWithRevision(client, id, revision, { status: 'disabled', disabled_at: new Date().toISOString(), updated_by: user.id });
      return adminJsonResponse(request, { item: publicAdminRow(result.after, url) });
    }
    if (action === 'archive') {
      const result = await updateWithRevision(client, id, revision, { status: 'archived', deleted_at: new Date().toISOString(), updated_by: user.id });
      return adminJsonResponse(request, { item: publicAdminRow(result.after, url) });
    }
    const current = await requireRevision(client, id, revision);
    const result = await updateWithRevision(client, id, revision, { artwork_path: null, updated_by: user.id });
    await removeObject(client, current.artwork_path);
    return adminJsonResponse(request, { item: publicAdminRow(result.after, url) });
  } catch (error) {
    return errorResponse(request, error);
  }
});
