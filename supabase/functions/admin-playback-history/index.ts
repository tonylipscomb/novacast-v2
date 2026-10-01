import { requireAdmin } from '../_shared/admin.ts';
import { adminJsonResponse, adminOptionsResponse } from '../_shared/http.ts';

const PAGE_SIZE_MAX = 100;
const ALLOWED_STATUS = new Set(['all', 'active', 'complete', 'failed']);

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return adminOptionsResponse(request);
  if (request.method !== 'GET') return adminJsonResponse(request, { errorCategory: 'method_not_allowed' }, 405);
  try {
    const { client } = await requireAdmin(request);
    const url = new URL(request.url);
    const page = Math.max(1, Math.floor(Number(url.searchParams.get('page') ?? 1) || 1));
    const pageSize = Math.min(Math.max(Math.floor(Number(url.searchParams.get('pageSize') ?? 25) || 25), 1), PAGE_SIZE_MAX);
    const hours = Math.min(Math.max(Number(url.searchParams.get('hours') ?? 168) || 168, 1), 720);
    const status = url.searchParams.get('status')?.trim().toLowerCase() ?? 'all';
    const providerId = url.searchParams.get('providerId')?.trim() ?? '';
    const deviceCode = url.searchParams.get('deviceId')?.trim().toUpperCase() ?? '';
    if (!ALLOWED_STATUS.has(status)) return adminJsonResponse(request, { errorCategory: 'invalid_filter' }, 400);
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    let deviceIds: string[] | null = null;
    if (deviceCode) {
      const deviceResult = await client.from('devices').select('id').eq('public_device_code', deviceCode).limit(1);
      if (deviceResult.error) throw new Error('admin_query_failed');
      deviceIds = deviceResult.data?.map((row) => row.id).filter((id): id is string => typeof id === 'string') ?? [];
      if (!deviceIds.length) return adminJsonResponse(request, { items: [], page, pageSize, total: 0, totalPages: 0, available: true });
    }
    let query = client.from('diagnostic_sessions').select('id,device_id,managed_provider_id,content_type,content_id,started_at,first_frame_at,ended_at,time_to_first_frame_ms,buffer_count,total_buffer_duration_ms,playback_duration_ms,last_error_code,last_native_error_code,last_http_status,exit_reason,diagnostic_status,likely_cause,likely_cause_explanation', { count: 'exact' }).gte('started_at', since);
    if (deviceIds) query = query.in('device_id', deviceIds);
    if (providerId) query = query.eq('managed_provider_id', providerId);
    if (status !== 'all') query = query.eq('diagnostic_status', status);
    const from = (page - 1) * pageSize;
    const result = await query.order('started_at', { ascending: false }).order('id', { ascending: true }).range(from, from + pageSize - 1);
    if (result.error) throw new Error('admin_query_failed');
    const sessions = result.data ?? [];
    const ids = [...new Set(sessions.map((row) => row.device_id).filter((id): id is string => typeof id === 'string'))];
    const providerIds = [...new Set(sessions.map((row) => row.managed_provider_id).filter((id): id is string => typeof id === 'string'))];
    const [devices, providers] = await Promise.all([
      ids.length ? client.from('devices').select('id,public_device_code,friendly_name').in('id', ids) : { data: [], error: null },
      providerIds.length ? client.from('managed_providers').select('id,display_name,slug').in('id', providerIds) : { data: [], error: null },
    ]);
    if (devices.error || providers.error) throw new Error('admin_query_failed');
    const deviceById = new Map((devices.data ?? []).map((row) => [row.id, row]));
    const providerById = new Map((providers.data ?? []).map((row) => [row.id, row]));
    const items = sessions.map((row) => {
      const device = deviceById.get(row.device_id);
      const provider = row.managed_provider_id ? providerById.get(row.managed_provider_id) : null;
      return {
        id: row.id,
        deviceKey: device?.public_device_code ?? row.device_id,
        deviceName: device?.friendly_name ?? null,
        provider: provider?.display_name ?? provider?.slug ?? 'Unassigned',
        contentType: row.content_type ?? 'Not reported',
        contentId: row.content_id ?? null,
        startedAt: row.started_at,
        firstFrameAt: row.first_frame_at,
        endedAt: row.ended_at,
        timeToFirstFrameMs: row.time_to_first_frame_ms,
        bufferCount: row.buffer_count,
        totalBufferDurationMs: row.total_buffer_duration_ms,
        playbackDurationMs: row.playback_duration_ms,
        result: row.diagnostic_status,
        exitReason: row.exit_reason,
        errorCategory: row.last_error_code ?? row.last_native_error_code ?? null,
        httpStatus: row.last_http_status,
        likelyCause: row.likely_cause,
        likelyCauseExplanation: row.likely_cause_explanation,
      };
    });
    const total = result.count ?? 0;
    return adminJsonResponse(request, { items, page, pageSize, total, totalPages: total ? Math.ceil(total / pageSize) : 0, available: true });
  } catch (error) {
    const unauthorized = error instanceof Error && error.message === 'admin_unauthorized';
    return adminJsonResponse(request, { errorCategory: unauthorized ? 'admin_unauthorized' : 'admin_query_failed' }, unauthorized ? 401 : 500);
  }
});
