import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './pairing';

export function AdminNovaPulseOps({ token }: { token: string }) {
  const [sources, setSources] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { setError(''); setSources(await adminRequest('admin-novapulse-ops', token)); } catch { setError('NovaPulse operations data is unavailable.'); } }, [token]);
  // The request is an external admin data lifecycle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  return <section className="cloudSimplePanel adminOpsPanel"><header><div><span className="eyebrow">CONTENT OPERATIONS</span><h2>NovaPulse health</h2><p>Feed freshness and persisted content signals. Request-time feeds report unknown until durable telemetry exists.</p></div><button onClick={() => void load()}>Refresh</button></header>
    {error ? <p className="adminError">{error}</p> : null}<div className="adminOpsCards">{Object.entries(sources?.sources ?? {}).map(([name, value]) => <div className="adminOpsCard" key={name}><small>{name}</small><strong>{String((value as any).state ?? 'unknown')}</strong><span>{(value as any).itemCount ?? (value as any).trendCount ?? '—'} items</span></div>)}</div>
    <div className="adminOpsNote">Sports refresh is server-authorized only. Use the existing Announcements screen for announcement actions; no browser surface exposes feed keys or provider credentials.</div></section>;
}
