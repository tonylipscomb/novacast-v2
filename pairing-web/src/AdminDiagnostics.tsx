import { useEffect, useMemo, useState } from 'react';
import { adminRequest } from './pairing';

type Row = Record<string, any>;
export function AdminDiagnostics({ token, onMessage }: { token: string; onMessage: (message: string) => void }) {
  const [data, setData] = useState<{ summary?: Row; devices?: Row[]; providers?: Row[]; events?: Row[] } | null>(null);
  const [hours, setHours] = useState('24');
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { setData(await adminRequest(`admin-diagnostics?hours=${hours}`, token)); }
    catch { onMessage('Diagnostics data could not be loaded.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [token, hours]);
  const summary = data?.summary ?? {};
  const devices = useMemo(() => data?.devices ?? [], [data]);
  return <div className="diagnosticsPage">
    <div className="diagnosticsToolbar"><span>Production beta telemetry</span><select value={hours} onChange={(event) => setHours(event.target.value)}><option value="1">Last hour</option><option value="24">24 hours</option><option value="168">7 days</option></select><button onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing' : 'Refresh'}</button></div>
    <div className="diagnosticMetricGrid">{[['TOTAL BETA DEVICES', summary.totalDevices], ['HEALTHY', summary.healthy], ['DEGRADED', summary.degraded], ['OFFLINE', summary.offline], ['ACTIVE PLAYBACK ISSUES', summary.activePlaybackIssues]].map(([label, value]) => <article className="diagnosticMetric" key={String(label)}><small>{label}</small><strong>{value ?? 0}</strong></article>)}</div>
    <section className="diagnosticPanel"><header><h2>Device health</h2><span>{devices.length} devices</span></header><div className="diagnosticTable">{devices.length ? devices.map((device) => <div className="diagnosticRow" key={device.device_id}><strong>{device.public_device_id ?? device.device_id}</strong><span>{device.device_model ?? 'Unknown device'}<small>{device.providerName}</small></span><b className={`diagnosticStatus ${String(device.health_status ?? 'UNKNOWN').toLowerCase()}`}>{device.health_status ?? 'UNKNOWN'}</b><span>{device.recentError?.event_type ?? 'No recent playback error'}<small>{device.likely_cause ?? 'UNKNOWN'}</small></span><time>{device.last_seen_at ? new Date(device.last_seen_at).toLocaleString() : 'Never seen'}</time></div>) : <p className="diagnosticEmpty">No diagnostic-safe health records have arrived yet.</p>}</div></section>
    <section className="diagnosticPanel"><header><h2>Recent events</h2></header>{(data?.events ?? []).slice(0, 12).map((event) => <div className="diagnosticEvent" key={event.id}><strong>{event.event_type}</strong><span>{event.error_code ?? event.metadata?.contentTitle ?? 'NovaCast playback telemetry'}</span><time>{new Date(event.event_at).toLocaleString()}</time></div>)}</section>
  </div>;
}
