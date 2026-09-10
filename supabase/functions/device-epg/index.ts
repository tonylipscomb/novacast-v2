import { authenticateDevice, deviceRateKey } from '../_shared/device.ts';
import { jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { consumeRateLimit, getAdminClient } from '../_shared/supabase.ts';

const SAFE_SOURCE_SELECT = 'id,safe_label,priority,managed_provider_id,active_cache_generation';
const SAFE_MAPPING_SELECT = 'xmltv_channel_id,match_type,match_confidence_class,cache_generation';
const SAFE_PROGRAM_SELECT = 'id,title,subtitle,description,category,start_at,stop_at,xmltv_channel_id';

function clampLimit(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? Math.min(12, Math.max(1, Math.floor(parsed))) : 3;
}

function safeStreamId(value: unknown) {
  if (typeof value === 'string' || typeof value === 'number') {
    const id = String(value).trim();
    return id.length > 0 && id.length <= 200 ? id : null;
  }
  return null;
}

function unavailable(errorCategory = 'managed_epg_unavailable', status = 200) {
  return jsonResponse({ ok: false, matched: false, errorCategory, programs: [], serverTime: new Date().toISOString() }, status);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return jsonResponse({ errorCategory: 'method_not_allowed' }, 405);

  try {
    const client = getAdminClient();
    const device = await authenticateDevice(request, client);
    if (!(await consumeRateLimit(client, await deviceRateKey(request, device.id, 'device-epg'), 120, 600))) {
      return unavailable('rate_limited', 429);
    }

    const body = await readJson(request);
    const streamId = safeStreamId(body?.streamId);
    if (!streamId) return unavailable('invalid_epg_request', 400);
    const limit = clampLimit(body?.limit);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const futureIso = new Date(now + 12 * 60 * 60 * 1000).toISOString();

    const { data: activation } = await client
      .from('device_activations')
      .select('status,expires_at')
      .eq('device_id', device.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!activation || (activation.expires_at && new Date(activation.expires_at).getTime() <= now)) {
      return unavailable('activation_required', 403);
    }

    const { data: assignment } = await client
      .from('device_provider_assignments')
      .select('managed_provider_id')
      .eq('device_id', device.id)
      .eq('status', 'active')
      .order('assigned_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!assignment?.managed_provider_id) return unavailable('provider_not_assigned');

    const { data: sources, error: sourceError } = await client
      .from('managed_provider_epg_sources')
      .select(SAFE_SOURCE_SELECT)
      .eq('managed_provider_id', assignment.managed_provider_id)
      .eq('enabled', true)
      .not('active_cache_generation', 'is', null)
      .order('priority', { ascending: true })
      .order('created_at', { ascending: true });
    if (sourceError) return unavailable();

    const candidates: Array<{ source: Record<string, unknown>; mapping: Record<string, unknown>; programs: Record<string, unknown>[]; hasCurrent: boolean }> = [];
    for (const source of sources ?? []) {
      const generation = typeof source.active_cache_generation === 'string' ? source.active_cache_generation : '';
      if (!generation) continue;
      const { data: mapping } = await client
        .from('managed_provider_epg_source_mappings')
        .select(SAFE_MAPPING_SELECT)
        .eq('managed_provider_id', assignment.managed_provider_id)
        .eq('source_id', source.id)
        .eq('cache_generation', generation)
        .eq('provider_stream_id', streamId)
        .eq('match_confidence_class', 'proven')
        .not('xmltv_channel_id', 'is', null)
        .maybeSingle();
      const xmltvChannelId = typeof mapping?.xmltv_channel_id === 'string' ? mapping.xmltv_channel_id : '';
      if (!mapping || !xmltvChannelId) continue;
      const { data: programmes } = await client
        .from('managed_provider_epg_source_programmes')
        .select(SAFE_PROGRAM_SELECT)
        .eq('managed_provider_id', assignment.managed_provider_id)
        .eq('source_id', source.id)
        .eq('cache_generation', generation)
        .eq('xmltv_channel_id', xmltvChannelId)
        .gt('stop_at', nowIso)
        .lt('start_at', futureIso)
        .order('start_at', { ascending: true })
        .limit(Math.max(limit, 12));
      const usable = (programmes ?? []).filter((program) => typeof program.start_at === 'string' && typeof program.stop_at === 'string' && new Date(program.stop_at).getTime() > new Date(program.start_at).getTime());
      if (usable.length) {
        candidates.push({ source, mapping, programs: usable, hasCurrent: usable.some((program) => new Date(program.start_at as string).getTime() <= now && new Date(program.stop_at as string).getTime() > now) });
      }
    }

    const selected = candidates.find((candidate) => candidate.hasCurrent) ?? candidates[0];
    if (!selected) return unavailable();
    const programs = selected.programs.slice().sort((left, right) => Date.parse(String(left.start_at)) - Date.parse(String(right.start_at))).slice(0, limit);
    return jsonResponse({
      ok: true,
      matched: true,
      source: { id: selected.source.id, label: selected.source.safe_label, priority: selected.source.priority },
      matchType: selected.mapping.match_type,
      programs: programs.map((program) => ({
        id: program.id,
        title: program.title,
        subtitle: program.subtitle,
        description: program.description,
        category: program.category,
        startAt: program.start_at,
        stopAt: program.stop_at,
      })),
      serverTime: new Date().toISOString(),
    });
  } catch {
    return unavailable();
  }
});
