import { authenticateDevice } from '../_shared/device.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import {
  ANNOUNCEMENT_FEED_SELECT,
  NOVAPULSE_ANNOUNCEMENT_MAX_ITEMS,
  announcementIsEligible,
  compareAnnouncements,
  toTvAnnouncement,
  type AnnouncementRow,
} from '../_shared/novapulseAnnouncements.ts';

const ACTIVE_IMPORTANCE = ['critical', 'important', 'normal'] as const;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'GET') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);

  try {
    const client = getAdminClient();
    const device = await authenticateDevice(request, client);
    if (device.activation_status !== 'active' || device.status !== 'active') {
      return jsonResponse({ errorCategory: 'device_not_authorized' }, 403);
    }
    const now = new Date();
    const nowIso = now.toISOString();
    const queries = await Promise.all(ACTIVE_IMPORTANCE.map((importance) => client
      .from('novapulse_announcements')
      .select(ANNOUNCEMENT_FEED_SELECT)
      .eq('status', 'published')
      .eq('importance', importance)
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
    const items = rows.filter((row) => announcementIsEligible(row, now)).sort(compareAnnouncements).slice(0, NOVAPULSE_ANNOUNCEMENT_MAX_ITEMS);
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    return jsonResponse({ ok: true, items: items.map((row) => toTvAnnouncement(row, url)) });
  } catch (error) {
    const category = error instanceof Error && error.message === 'invalid_device' ? 'invalid_device' : 'announcement_feed_unavailable';
    return jsonResponse({ errorCategory: category }, category === 'invalid_device' ? 401 : 503);
  }
});
