import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './pairing';

type Release = { id: string; version_name: string; version_code: number; channel: string; status: string; package_name: string; git_commit?: string | null; git_tag?: string | null; artifact_name?: string | null; sha256?: string | null; signing_cert_sha256?: string | null; created_at: string; promoted_at?: string | null };
type Distribution = { versionName: string; versionCode: number | null; bucket: string; count: number; devices: { publicDeviceCode?: string | null; friendlyName?: string | null; lastSeenAt?: string | null }[] };
type ReleaseResponse = { production: (Release & { adoption: { count: number; percentage: number }; outdatedCount: number; aheadCount: number; unknownCount: number }) | null; releases: Release[]; distribution: Distribution[]; telemetry: { observedDeviceCount: number; bounded: boolean } };

function shortHash(value: string | null | undefined) { return value ? `${value.slice(0, 8)}…` : '—'; }

export function AdminReleases({ token, onOpenDevice }: { token: string; onOpenDevice?: (code: string) => void }) {
  const [data, setData] = useState<ReleaseResponse | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { setError(''); setData(await adminRequest(`admin-releases?page=${page}&pageSize=25`, token)); } catch { setError('Release catalog data is unavailable.'); } }, [page, token]);
  // The request is an external admin data lifecycle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const production = data?.production;
  return <section className="cloudSimplePanel adminOpsPanel releaseOpsPanel"><header><div><span className="eyebrow">RELEASE OPERATIONS</span><h2>Release catalog</h2><p>Explicit release metadata and observed device adoption. No release is promoted from this view.</p></div><button onClick={() => void load()}>Refresh</button></header>
    {error ? <p className="adminError">{error}</p> : null}
    <div className="releaseSummary"><div><small>Current production</small><strong>{production?.version_name ?? 'Unknown'}</strong><span>{production ? `Build ${production.version_code} · ${production.package_name}` : 'No active production record'}</span></div><div><small>Adoption</small><strong>{production ? `${production.adoption.percentage}%` : '—'}</strong><span>{production?.adoption.count ?? 0} observed devices</span></div><div><small>Outdated</small><strong>{production?.outdatedCount ?? '—'}</strong><span>Ahead {production?.aheadCount ?? '—'} · Unknown {production?.unknownCount ?? '—'}</span></div></div>
    {production ? <div className="releaseDetail"><b>{production.git_tag ?? 'No tag'} · {shortHash(production.git_commit)}</b><span>{production.artifact_name ?? 'Artifact unavailable'} · SHA {production.sha256 ? 'present' : 'unknown'} · signing cert {production.signing_cert_sha256 ? 'present' : 'unknown'}</span></div> : null}
    <h3>Catalog</h3><div className="adminOpsTable"><div className="adminOpsRow releaseOpsRow adminOpsHeading"><span>Release</span><span>Channel/status</span><span>Package/build</span><span>Verification</span></div>{(data?.releases ?? []).map((release) => <div className="adminOpsRow releaseOpsRow" key={release.id}><span><b>{release.version_name}</b><small>{release.git_tag ?? shortHash(release.git_commit)}</small></span><span><b>{release.channel}</b><small>{release.status}</small></span><span><b>{release.package_name}</b><small>{release.version_code}</small></span><span><b>{release.sha256 ? 'SHA present' : 'SHA unknown'}</b><small>{release.signing_cert_sha256 ? 'Cert present' : 'Cert unknown'}</small></span></div>)}</div>
    <h3>Device distribution</h3><div className="adminOpsTable"><div className="adminOpsRow releaseDistributionRow adminOpsHeading"><span>Version</span><span>Classification</span><span>Devices</span><span>Examples</span></div>{(data?.distribution ?? []).map((row) => <div className="adminOpsRow releaseDistributionRow" key={`${row.versionName}-${row.versionCode}-${row.bucket}`}><span>{row.versionName} · {row.versionCode ?? 'unknown'}</span><span>{row.bucket}</span><span>{row.count}</span><span>{row.devices.slice(0, 3).map((device) => <button className="opsInlineAction" key={device.publicDeviceCode ?? device.friendlyName} onClick={() => device.publicDeviceCode && onOpenDevice?.(device.publicDeviceCode)}>{device.publicDeviceCode ?? device.friendlyName ?? 'Unknown device'}</button>)}</span></div>)}</div>
    <p className="adminOpsNote">Telemetry observed from at most {data?.telemetry.observedDeviceCount ?? 0} devices; the backend reports when this bounded view is capped. Release promotion and redirect changes remain manual.</p>
    <footer className="adminPager"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page}</span><button disabled={(data?.releases.length ?? 0) < 25} onClick={() => setPage((value) => value + 1)}>Next</button></footer>
  </section>;
}
