import type { GoldAccountCredentials, GoldAccountInfo, GoldPackagesResult, GoldPackage, GoldReseller, GoldRouteHealth } from './goldPanelTypes.ts';
import { sanitizeGoldError, sanitizeGoldText } from './goldPanelSanitization.ts';

const DEFAULT_API_URL = 'https://8k.cms-only.ru/api/api.php';

function asRecord(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return asRecord(value[0]);
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function bool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    if (['true', '1', 'yes', 'enabled', 'active'].includes(value.toLowerCase())) return true;
    if (['false', '0', 'no', 'disabled', 'inactive'].includes(value.toLowerCase())) return false;
  }
  return null;
}

function number(value: unknown): number | null {
  const result = typeof value === 'number' ? value : Number(String(value ?? ''));
  return Number.isFinite(result) ? result : null;
}

function success(payload: unknown): boolean {
  const row = asRecord(payload);
  const value = row.success ?? row.status ?? row.result;
  return value === undefined ? true : bool(value) === true || value === 'success' || value === 'ok';
}

function responseText(payload: unknown, secrets: string[] = []): string {
  const row = asRecord(payload);
  const value = [row.message, row.error, row.msg, row.result].find((candidate): candidate is string => typeof candidate === 'string');
  return sanitizeGoldError(value ?? 'Gold Panel request failed', secrets);
}

export class GoldPanelError extends Error {
  readonly category: string;
  readonly status: number;
  constructor(category: string, message: string, status = 502) {
    super(message);
    this.category = category;
    this.status = status;
  }
}

export function goldApiUrl() {
  return (Deno.env.get('GOLD_PANEL_API_URL') || DEFAULT_API_URL).trim();
}

async function request(
  params: Record<string, string>,
  timeoutMs = 12_000,
  options: { validateOperationStatus?: boolean } = {},
): Promise<unknown> {
  const apiKey = Deno.env.get('GOLD_PANEL_API_KEY');
  if (!apiKey) throw new GoldPanelError('gold_configuration_error', 'Gold Panel API key is not configured.', 500);
  const url = new URL(goldApiUrl());
  const query = new URLSearchParams({ ...params, api_key: apiKey });
  url.search = query.toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { redirect: 'error', signal: controller.signal });
    const text = await response.text();
    let payload: unknown;
    try { payload = JSON.parse(text); } catch { throw new GoldPanelError('gold_invalid_response', 'Gold Panel returned malformed JSON.'); }
    if (!response.ok) throw new GoldPanelError('gold_http_failure', `Gold Panel HTTP ${response.status}.`, 502);
    if (options.validateOperationStatus !== false && !success(payload)) {
      throw new GoldPanelError('gold_operation_failed', responseText(payload, [apiKey]));
    }
    return payload;
  } catch (error) {
    if (error instanceof GoldPanelError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') throw new GoldPanelError('gold_timeout', 'Gold Panel request timed out.', 504);
    throw new GoldPanelError('gold_unreachable', 'Gold Panel could not be reached.');
  } finally { clearTimeout(timer); }
}

export async function getReseller(): Promise<GoldReseller> {
  const row = asRecord(await request({ action: 'reseller' }));
  const reseller = asRecord(row.reseller ?? row);
  return { username: sanitizeGoldText(reseller.username, 128), credits: number(reseller.credits), enabled: bool(reseller.enabled) };
}

export async function getPackages(): Promise<GoldPackagesResult> {
  const payload = await request({ action: 'bouquet' }, 12_000, { validateOperationStatus: false });
  if (!Array.isArray(payload)) {
    const row = asRecord(payload);
    const statusIsError = typeof row.status === 'string' && row.status.trim().toLowerCase() === 'error';
    const emptyCustomBouquet = statusIsError && ['result', 'message'].some((key) => (
      typeof row[key] === 'string' && row[key].trim().toLowerCase() === 'empty custom bouquet'
    ));
    if (emptyCustomBouquet) return { packages: [], emptyReason: 'no_custom_bouquets' };
    const hasGoldError =
      statusIsError ||
      bool(row.success) === false ||
      bool(row.status) === false ||
      ['error', 'message', 'msg'].some((key) => typeof row[key] === 'string' && row[key].trim());
    throw new GoldPanelError(
      hasGoldError ? 'gold_operation_failed' : 'gold_packages_invalid_response',
      hasGoldError
        ? responseText(payload, [Deno.env.get('GOLD_PANEL_API_KEY') ?? ''])
        : 'Gold Panel returned an invalid package response.',
      502,
    );
  }
  const packages = payload
    .map((value) => {
      const item = asRecord(value);
      const rawId = item.id ?? item.package_id;
      const rawName = item.name ?? item.package_name;
      if (!((typeof rawId === 'string' || typeof rawId === 'number') && typeof rawName === 'string')) return null;
      return { id: String(rawId).trim(), name: sanitizeGoldText(rawName, 160) ?? '' };
    })
    .filter((item): item is GoldPackage => Boolean(item?.id && item.name));
  return { packages };
}

export function parseM3uUrl(value: unknown): GoldAccountCredentials {
  if (typeof value !== 'string' || !value.trim()) throw new GoldPanelError('gold_m3u_missing', 'Gold Panel did not return an M3U URL.', 502);
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new GoldPanelError('gold_m3u_invalid', 'Gold Panel returned an invalid M3U URL.', 502); }
  const username = url.searchParams.get('username');
  const password = url.searchParams.get('password');
  if (!username || !password || !/^https?:$/.test(url.protocol)) throw new GoldPanelError('gold_m3u_invalid', 'Gold Panel returned an unusable M3U URL.', 502);
  const baseUrl = `${url.protocol}//${url.host}`;
  return { type: 'xtream', baseUrl, username, password, upstreamUrl: value.trim(), output: url.searchParams.get('output') };
}

export function safeGoldBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    return `${url.protocol}//${url.host}`;
  } catch { return null; }
}

function findUrl(value: unknown): string | null {
  if (typeof value === 'string' && /https?:\/\/[^\s"']+get\.php\?/i.test(value)) return value.match(/https?:\/\/[^\s"']+get\.php\?[^\s"']+/i)?.[0] ?? null;
  if (Array.isArray(value)) for (const item of value) { const found = findUrl(item); if (found) return found; }
  if (value && typeof value === 'object') for (const item of Object.values(value as Record<string, unknown>)) { const found = findUrl(item); if (found) return found; }
  return null;
}

export async function createM3uAccount(input: { sub: string; pack: string; country: string; notes?: string }): Promise<GoldAccountCredentials> {
  const payload = await request({ action: 'new', type: 'm3u', sub: input.sub, pack: input.pack, country: input.country, notes: input.notes ?? '' });
  const url = findUrl(payload);
  return parseM3uUrl(url);
}

export async function getDeviceInfo(username: string, password: string): Promise<GoldAccountInfo> {
  const payload = await request({ action: 'device_info', username, password });
  const row = asRecord(payload);
  return {
    goldUserId: sanitizeGoldText(row.goldUserId ?? row.gold_user_id ?? row.id ?? row.user_id, 128),
    username: sanitizeGoldText(row.username ?? username, 128),
    expire: sanitizeGoldText(row.expire ?? row.expiration ?? row.exp_date, 64),
    country: sanitizeGoldText(row.country, 8),
    notes: sanitizeGoldText(row.notes, 500),
    upstreamUrl: safeGoldBaseUrl(row.upstreamUrl ?? row.upstream_url ?? row.url),
    enabled: bool(row.enabled ?? row.status),
  };
}

export async function renewAccount(input: { username: string; password: string; sub: string }) { return request({ action: 'renew', type: 'm3u', ...input }); }
export async function setAccountStatus(goldUserId: string, enabled: boolean) { return request({ action: 'device_status', status: enabled ? 'enable' : 'disable', id: goldUserId }); }

export async function checkGoldRoute(domain: string): Promise<GoldRouteHealth> {
  const trimmed = domain.trim();
  if (!trimmed || trimmed.includes('*')) throw new GoldPanelError('gold_wildcard_route', 'A concrete route hostname is required for Cloud Route Check.', 400);
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`); } catch { throw new GoldPanelError('gold_invalid_route', 'Enter a valid route hostname.', 400); }
  if (url.username || url.password || url.search || url.hash) throw new GoldPanelError('gold_invalid_route', 'Route must not contain credentials or query parameters.', 400);
  url.pathname = '/c/'; url.search = '';
  const started = Date.now(); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { redirect: 'error', signal: controller.signal });
    const body = sanitizeGoldError((await response.text()).replace(/<[^>]*>/g, ' '), [], 160);
    return { reachable: response.ok, status: response.status, latencyMs: Date.now() - started, responseSummary: body || (response.ok ? 'Route responded.' : 'Upstream Route Error'), checkedAt: new Date().toISOString() };
  } catch { return { reachable: false, status: null, latencyMs: Date.now() - started, responseSummary: 'Upstream Route Error', checkedAt: new Date().toISOString() }; }
  finally { clearTimeout(timer); }
}
