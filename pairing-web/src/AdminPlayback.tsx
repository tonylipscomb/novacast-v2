import { useEffect, useState } from 'react';
import { adminRequest } from './pairing';
import { formatTimestamp } from './providerHealthDisplay';
import type { Row } from './operationsCenter';

type PlaybackResult = { available: boolean; items: Row[]; page: number; pageSize: number; total: number; totalPages: number };

export function AdminPlayback({ token, devices, providers, onOpenDevice }: { token: string; devices: Row[]; providers: Row[]; onOpenDevice: (deviceKey: string) => void }) {
  const [status, setStatus] = useState('all');
  const [providerId, setProviderId] = useState('all');
  const [deviceId, setDeviceId] = useState('all');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<PlaybackResult>({ available: true, items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(page), pageSize: '25', status, hours: '168' });
    if (providerId !== 'all') params.set('providerId', providerId);
    if (deviceId !== 'all') params.set('deviceId', deviceId);
    void adminRequest(`admin-playback-history?${params.toString()}`, token).then((data) => { if (active) setResult({ available: data.available !== false, items: Array.isArray(data.items) ? data.items : [], page: Number(data.page ?? page), pageSize: Number(data.pageSize ?? 25), total: Number(data.total ?? 0), totalPages: Number(data.totalPages ?? 0) }); }).catch(() => { if (active) setResult({ available: false, items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 }); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, page, status, providerId, deviceId]);
  return (
    <section className="playbackPage">
      <header className="simplePageHeader"><div><span className="eyebrow">OPERATIONS</span><h2>Playback issues</h2><p>Read-only playback and recovery signals reported by NovaCast devices.</p></div></header>
      <div className="inviteFilters"><select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value); }} aria-label="Filter playback result"><option value="all">All results</option><option value="failed">Failed</option><option value="complete">Complete</option><option value="active">Active</option></select><select value={providerId} onChange={(event) => { setPage(1); setProviderId(event.target.value); }} aria-label="Filter playback provider"><option value="all">All providers</option>{providers.map((provider) => <option key={String(provider.id)} value={String(provider.id)}>{String(provider.display_name ?? provider.slug ?? 'Provider')}</option>)}</select><select value={deviceId} onChange={(event) => { setPage(1); setDeviceId(event.target.value); }} aria-label="Filter playback device"><option value="all">All devices</option>{devices.map((device) => <option key={String(device.public_device_code ?? device.id)} value={String(device.public_device_code ?? device.id)}>{String(device.public_device_code ?? device.friendly_name ?? 'Device')}</option>)}</select></div>
      {loading ? <div className="providerEmptyState"><span>Loading playback history…</span></div> : !result.available ? <div className="providerEmptyState"><strong>Playback telemetry unavailable</strong><span>The persisted playback history service could not provide data.</span></div> : result.items.length === 0 ? <div className="providerEmptyState"><strong>No recent playback history</strong><span>No persisted playback sessions matched these filters.</span></div> : <div className="opsTableWrap"><table className="opsTable"><thead><tr><th>Device</th><th>Provider</th><th>Content</th><th>Result</th><th>Cause</th><th>Timestamp</th><th>Recovery</th></tr></thead><tbody>{result.items.map((row) => <tr key={String(row.id)}><td><button className="opsTableLink" onClick={() => onOpenDevice(String(row.deviceKey))}>{String(row.deviceKey)}</button></td><td>{String(row.provider ?? 'Unassigned')}</td><td>{String(row.contentType ?? 'Not reported')}</td><td>{String(row.result ?? 'Not reported')}</td><td>{String(row.errorCategory ?? row.likelyCause ?? 'Not reported')}</td><td>{row.startedAt ? formatTimestamp(String(row.startedAt)) : 'Not reported'}</td><td>{String(row.recovery ?? 'Not persisted')}</td></tr>)}</tbody></table><footer className="devicePagination"><span>{result.total} persisted sessions</span><div><button disabled={result.page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><strong>{result.page} / {Math.max(result.totalPages, 1)}</strong><button disabled={result.page >= result.totalPages} onClick={() => setPage((value) => value + 1)}>Next</button></div></footer></div>}
    </section>
  );
}
