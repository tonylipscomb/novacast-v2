import { authenticateActiveDevice } from '../_shared/device.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import {
  ANNOUNCEMENT_FEED_SELECT,
  selectAnnouncementRows,
  toTvAnnouncement,
  type AnnouncementRow,
} from '../_shared/novapulseAnnouncements.ts';

const ACTIVE_IMPORTANCE = ['critical', 'important', 'normal'] as const;

function feedResponse(body: Record<string, unknown>, status = 200) {
  const response = jsonResponse(body, status);
  response.headers.set('Cache-Control', 'no-store, max-age=0');
  return response;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'GET') return feedResponse({ errorCategory: 'method_not_allowed' }, 405);

  try {
    const client = getAdminClient();
    await authenticateActiveDevice(request, client);
    const now = new Date();
    const nowIso = now.toISOString();
    const queries = await Promise.all(ACTIVE_IMPORTANCE.map((importance) => client
      .from('novapulse_announcements')
      .select(ANNOUNCEMENT_FEED_SELECT)
      .eq('status', 'published')
      .eq('importance', importance)
      .neq('kind', 'provider_alert')
      .is('deleted_at', null)
      .is('disabled_at', null)
      .or(`starts_at.is.null,starts_at.lte.${nowIso}`)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .order('priority', { ascending: false })
      .limit(100)));
    const failed = queries.find((result) => result.error);
    if (failed?.error) {
      console.error('[NovaPulse Announcements Feed]', JSON.stringify({ errorCategory: 'database_query_failed' }));
      return jsonResponse({ errorCategory: 'announcement_feed_unavailable' }, 503);
    }
    const rows = queries.flatMap((result) => result.data ?? []) as unknown as AnnouncementRow[];
    const items = selectAnnouncementRows(rows, now);
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    return feedResponse({ ok: true, items: items.map((row) => toTvAnnouncement(row, url)) });
  } catch (error) {
    const category = error instanceof Error
      ? error.message === 'invalid_device'
        ? 'invalid_device'
        : error.message === 'device_not_authorized'
          ? 'device_not_authorized'
          : 'announcement_feed_unavailable'
      : 'announcement_feed_unavailable';
    return feedResponse({ errorCategory: category }, category === 'invalid_device' ? 401 : category === 'device_not_authorized' ? 403 : 503);
  }
});
