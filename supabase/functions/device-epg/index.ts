import { authenticateDevice, deviceRateKey } from '../_shared/device.ts';
import { jsonResponse, optionsResponse, readJson } from '../_shared/http.ts';
import { consumeRateLimit, getAdminClient } from '../_shared/supabase.ts';

const SAFE_SOURCE_SELECT = 'id,safe_label,priority,managed_provider_id,active_cache_generation';
const SAFE_MAPPING_SELECT = 'provider_stream_id,xmltv_channel_id,match_type,match_confidence_class,cache_generation';
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
    const requestedIds = Array.isArray(body?.streamIds)
      ? Array.from(new Set(body.streamIds.map(safeStreamId).filter((id): id is string => Boolean(id))))
      : [safeStreamId(body?.streamId)].filter((id): id is string => Boolean(id));
    if (!requestedIds.length || requestedIds.length > 32) return unavailable('invalid_epg_request', 400);
    const isBatch = Array.isArray(body?.streamIds);
    const limit = isBatch ? Math.min(3, clampLimit(body?.limit)) : clampLimit(body?.limit);
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

    const candidatesByStream = new Map<string, Array<{ source: Record<string, unknown>; mapping: Record<string, unknown>; programs: Record<string, unknown>[]; hasCurrent: boolean }>>();
    for (const source of sources ?? []) {
      const generation = typeof source.active_cache_generation === 'string' ? source.active_cache_generation : '';
      if (!generation) continue;
      const { data: mappings } = await client
        .from('managed_provider_epg_source_mappings')
        .select(SAFE_MAPPING_SELECT)
        .eq('managed_provider_id', assignment.managed_provider_id)
        .eq('source_id', source.id)
        .eq('cache_generation', generation)
        .in('provider_stream_id', requestedIds)
        .eq('match_confidence_class', 'proven')
        .not('xmltv_channel_id', 'is', null);
      const validMappings = (mappings ?? []).filter((mapping) => typeof mapping.xmltv_channel_id === 'string' && mapping.xmltv_channel_id);
      if (!validMappings.length) continue;
      const xmltvIds = Array.from(new Set(validMappings.map((mapping) => String(mapping.xmltv_channel_id))));
      const { data: programmes } = await client
        .from('managed_provider_epg_source_programmes')
        .select(SAFE_PROGRAM_SELECT)
        .eq('managed_provider_id', assignment.managed_provider_id)
        .eq('source_id', source.id)
        .eq('cache_generation', generation)
        .in('xmltv_channel_id', xmltvIds)
        .gt('stop_at', nowIso)
        .lt('start_at', futureIso)
        .order('start_at', { ascending: true })
        .limit(requestedIds.length * Math.max(limit, 12));
      for (const mapping of validMappings) {
        const xmltvChannelId = String(mapping.xmltv_channel_id);
        const usable = (programmes ?? []).filter((program) => program.xmltv_channel_id === xmltvChannelId && typeof program.start_at === 'string' && typeof program.stop_at === 'string' && new Date(program.stop_at).getTime() > new Date(program.start_at).getTime());
        if (usable.length) {
          const providerStreamId = String(mapping.provider_stream_id ?? '');
          if (!providerStreamId) continue;
          const list = candidatesByStream.get(providerStreamId) ?? [];
          list.push({ source, mapping, programs: usable, hasCurrent: usable.some((program) => new Date(program.start_at as string).getTime() <= now && new Date(program.stop_at as string).getTime() > now) });
          candidatesByStream.set(providerStreamId, list);
        }
      }
    }

    const buildResult = (streamId: string) => {
      const candidates = candidatesByStream.get(streamId) ?? [];
      const selected = candidates.find((candidate) => candidate.hasCurrent) ?? candidates[0];
      if (!selected) return { matched: false, programs: [] };
      const programs = selected.programs.slice().sort((left, right) => Date.parse(String(left.start_at)) - Date.parse(String(right.start_at))).slice(0, limit);
      return {
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
      };
    };
    if (isBatch) {
      return jsonResponse({
        ok: true,
        results: Object.fromEntries(requestedIds.map((id) => [id, buildResult(id)])),
        serverTime: new Date().toISOString(),
      });
    }
    const result = buildResult(requestedIds[0]);
    if (!result.matched) return unavailable();
    return jsonResponse({
      ok: true,
      matched: true,
      source: result.source,
      matchType: result.matchType,
      programs: result.programs,
      serverTime: new Date().toISOString(),
    });
  } catch {
    return unavailable();
  }
});
