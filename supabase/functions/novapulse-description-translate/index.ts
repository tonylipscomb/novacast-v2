import { authenticateDevice } from '../_shared/device.ts';
import { jsonResponse, optionsResponse } from '../_shared/http.ts';
import { getAdminClient } from '../_shared/supabase.ts';
import {
  isValidTranslationRequest,
  MAX_TRANSLATION_TEXT_BYTES,
  normalizeTranslatedText,
  type TranslationRequest,
} from '../_shared/novapulseTranslation.ts';

const TRANSLATION_RATE_LIMIT = 8;
const TRANSLATION_WINDOW_SECONDS = 60 * 60;
const cache = new Map<string, { translation: string; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 5_000;

function cacheKey(input: TranslationRequest) {
  return [input.providerId, input.mediaType, input.itemId, input.sourceTextHash, input.targetLanguage].join(':');
}

function errorResponse(error: string, status: number) {
  return jsonResponse({ ok: false, error }, status);
}

async function translate(input: TranslationRequest, apiKey: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
  const response = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: input.sourceText, target: input.targetLanguage, format: 'text' }),
    signal: controller.signal,
  });
  const payload = await response.json().catch(() => null) as { data?: { translations?: Array<{ translatedText?: unknown }> } } | null;
  if (!response.ok) throw new Error('translation_upstream_failed');
  return normalizeTranslatedText(payload?.data?.translations?.[0]?.translatedText);
  } finally { clearTimeout(timeout); }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return optionsResponse();
  if (request.method !== 'POST') return errorResponse('method_not_allowed', 405);
  try {
    const client = getAdminClient();
    const device = await authenticateDevice(request, client);
    const rateLimit = await client.rpc('consume_analytics_rate_limit', {
      p_device_id: device.id,
      p_event_count: 1,
      p_limit: TRANSLATION_RATE_LIMIT,
      p_window_seconds: TRANSLATION_WINDOW_SECONDS,
    });
    if (rateLimit.error) return errorResponse('temporary_database_error', 503);
    if (!rateLimit.data) return errorResponse('rate_limited', 429);
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_TRANSLATION_TEXT_BYTES) return errorResponse('body_size_limit', 413);
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return errorResponse('invalid_json', 400); }
    if (!isValidTranslationRequest(body)) return errorResponse('invalid_request', 400);
    const input = body;
    const key = cacheKey(input);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return jsonResponse({ ok: true, translation: cached.translation, cacheHit: true });
    cache.delete(key);
    const apiKey = Deno.env.get('GOOGLE_CLOUD_TRANSLATE_API_KEY')?.trim();
    if (!apiKey) return errorResponse('translation_not_configured', 503);
    const translation = await translate(input, apiKey);
    if (!translation) return jsonResponse({ ok: true, translation: null, cacheHit: false });
    cache.set(key, { translation, expiresAt: Date.now() + CACHE_TTL_MS });
    while (cache.size > 128) cache.delete(cache.keys().next().value as string);
    console.info('[NOVAPULSE_TRANSLATION]', JSON.stringify({ mediaType: input.mediaType, sourceLength: input.sourceText.length, translatedLength: translation.length, cacheHit: false }));
    return jsonResponse({ ok: true, translation, cacheHit: false });
  } catch (error) {
    if (error instanceof Error && error.message === 'invalid_device') return errorResponse('invalid_device', 401);
    console.info('[NOVAPULSE_TRANSLATION]', JSON.stringify({ outcome: 'failed' }));
    return errorResponse('translation_failed', 503);
  }
});
