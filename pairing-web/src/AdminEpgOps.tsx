import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './pairing';

export function AdminEpgOps({ token }: { token: string }) {
  const [data, setData] = useState<{ providers?: Record<string, unknown>[]; sources?: Record<string, unknown>[] } | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { setError(''); setData(await adminRequest('admin-epg-ops', token)); } catch { setError('EPG operations data is unavailable.'); } }, [token]);
  // The request is an external admin data lifecycle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  return <section className="cloudSimplePanel adminOpsPanel"><header><div><span className="eyebrow">CONTENT OPERATIONS</span><h2>EPG operations</h2><p>Provider coverage, freshness, source health, and affected-device counts.</p></div><button onClick={() => void load()}>Refresh</button></header>
    {error ? <p className="adminError">{error}</p> : null}<div className="adminOpsTable"><div className="adminOpsRow adminOpsHeading"><span>Provider</span><span>Sources</span><span>Devices</span><span>Freshness</span></div>{(data?.providers ?? []).map((provider) => <div className="adminOpsRow" key={provider.id}><span>{provider.name}</span><span>{provider.sourceCount}</span><span>{provider.assignedDeviceCount}</span><span>{provider.freshness?.state ?? 'unknown'}</span></div>)}</div><p className="adminOpsNote">Only safe labels, counts, statuses, and diagnostic categories are shown. Encrypted EPG URLs and tokens remain server-side.</p></section>;
}
