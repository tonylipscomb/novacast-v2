import { adminJsonResponse, adminOptionsResponse } from '../_shared/http.ts';
import { requireAdmin } from '../_shared/admin.ts';

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 25;
const PRODUCTION_PACKAGE = 'com.novacast.novacastv2';

function positiveInteger(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function normalizeBuild(value: unknown) {
  const text = value == null ? '' : String(value).trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

function classifyDevice(version: unknown, build: unknown, releaseMap: Map<string, Record<string, unknown>>, productionCode: number | null) {
  const versionName = typeof version === 'string' ? version.trim() : '';
  const versionCode = normalizeBuild(build);
  const release = releaseMap.get(`${versionName}\u0000${versionCode ?? ''}`);
  if (!versionName || versionCode === null || !release) return { bucket: 'unknown', releaseId: null };
  const releaseId = typeof release.id === 'string' ? release.id : null;
  if (release.channel === 'dev' || release.channel === 'beta') return { bucket: release.channel, releaseId };
  if (productionCode !== null && versionCode < productionCode) return { bucket: 'outdated', releaseId };
  if (productionCode !== null && versionCode > productionCode) return { bucket: 'ahead', releaseId };
  return { bucket: 'production', releaseId };
}

type DistributionRow = { versionName: string; versionCode: number | null; releaseId: string | null; bucket: string; count: number; devices: Array<Record<string, unknown>> };

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return adminOptionsResponse(request);
  if (request.method !== 'GET') return adminJsonResponse(request, { errorCategory: 'method_not_allowed' }, 405);

  try {
    const { client } = await requireAdmin(request);
    const url = new URL(request.url);
    const page = positiveInteger(url.searchParams.get('page'), 1, 10_000);
    const pageSize = positiveInteger(url.searchParams.get('pageSize'), DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const channel = url.searchParams.get('channel');
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let releaseQuery = client.from('novacast_releases').select('id,version_name,version_code,channel,status,package_name,git_commit,git_tag,artifact_name,artifact_url,sha256,signing_cert_sha256,release_notes,minimum_supported_version_code,created_at,promoted_at,retired_at', { count: 'exact' }).order('version_code', { ascending: false }).order('created_at', { ascending: false });
    if (channel && ['production', 'beta', 'dev', 'retired', 'other'].includes(channel)) releaseQuery = releaseQuery.eq('channel', channel);
    const [releases, catalog, production, devices] = await Promise.all([
      releaseQuery.range(from, to),
      client.from('novacast_releases').select('id,version_name,version_code,channel,status,package_name,git_commit,git_tag,artifact_name,artifact_url,sha256,signing_cert_sha256,release_notes,minimum_supported_version_code,created_at,promoted_at,retired_at').order('version_code', { ascending: false }).limit(500),
      client.from('novacast_releases').select('id,version_name,version_code,channel,status,package_name,git_commit,git_tag,artifact_name,artifact_url,sha256,signing_cert_sha256,release_notes,minimum_supported_version_code,created_at,promoted_at,retired_at').eq('package_name', PRODUCTION_PACKAGE).eq('channel', 'production').eq('status', 'active').limit(1),
      client.from('devices').select('id,public_device_code,friendly_name,app_version,app_build,last_seen_at').order('last_seen_at', { ascending: false }).limit(5000),
    ]);
    if (releases.error || catalog.error || production.error || devices.error) throw new Error('admin_query_failed');

    const productionRelease = production.data?.[0] ?? null;
    const productionCode = productionRelease ? Number(productionRelease.version_code) : null;
    const releaseMap = new Map((catalog.data ?? []).map((release) => [`${release.version_name}\u0000${release.version_code}`, release as Record<string, unknown>]));
    const allCatalogRows = releases.data ?? [];
    const distribution = new Map<string, DistributionRow>();
    for (const device of devices.data ?? []) {
      const classified = classifyDevice(device.app_version, device.app_build, releaseMap, productionCode);
      const key = `${device.app_version ?? 'Unknown'}\u0000${device.app_build ?? ''}\u0000${classified.bucket}`;
      const current = distribution.get(key) ?? { versionName: String(device.app_version ?? 'Unknown'), versionCode: normalizeBuild(device.app_build), releaseId: classified.releaseId, bucket: classified.bucket, count: 0, devices: [] };
      current.count += 1;
      if (current.devices.length < 25) current.devices.push({ publicDeviceCode: device.public_device_code, friendlyName: device.friendly_name, lastSeenAt: device.last_seen_at });
      distribution.set(key, current);
    }
    const distributionRows = [...distribution.values()].sort((a, b) => b.count - a.count || a.versionName.localeCompare(b.versionName));
    const totalObserved = (devices.data ?? []).length;
    const productionCount = distributionRows.filter((row) => row.bucket === 'production').reduce((sum, row) => sum + row.count, 0);
    const outdatedCount = distributionRows.filter((row) => row.bucket === 'outdated').reduce((sum, row) => sum + row.count, 0);
    const aheadCount = distributionRows.filter((row) => row.bucket === 'ahead').reduce((sum, row) => sum + row.count, 0);
    const unknownCount = distributionRows.filter((row) => row.bucket === 'unknown').reduce((sum, row) => sum + row.count, 0);

    return adminJsonResponse(request, {
      page, pageSize, total: releases.count ?? 0, totalPages: Math.ceil((releases.count ?? 0) / pageSize),
      production: productionRelease ? { ...productionRelease, adoption: { count: productionCount, percentage: totalObserved ? Math.round((productionCount / totalObserved) * 1000) / 10 : 0 }, outdatedCount, aheadCount, unknownCount } : null,
      releases: allCatalogRows,
      distribution: distributionRows,
      telemetry: { observedDeviceCount: totalObserved, bounded: true, maximumRows: 5000 },
    });
  } catch (error) {
    const category = error instanceof Error && error.message === 'admin_unauthorized' ? error.message : 'admin_request_failed';
    return adminJsonResponse(request, { errorCategory: category }, category === 'admin_unauthorized' ? 401 : 500);
  }
});
