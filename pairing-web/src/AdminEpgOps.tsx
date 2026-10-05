import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './pairing';

type EpgFreshness = { state: 'fresh' | 'stale' | 'unknown'; ageMs: number | null };
type EpgProvider = {
  id: string;
  name: string;
  status: string;
  epgMode: string;
  sourceCount: number;
  assignedDeviceCount: number;
  lastRefreshAt: string | null;
  lastRefreshStatus: string | null;
  freshness: EpgFreshness;
  latestResult: { status: string; requestedAt: string; completedAt: string | null; failureCode: string | null } | null;
};
type EpgSource = {
  id: string;
  providerId: string;
  providerName: string;
  kind: string;
  label: string;
  priority: number;
  enabled: boolean;
  lastRefreshAt: string | null;
  lastRefreshStatus: string | null;
  channelCount: number | null;
  programmeCount: number | null;
  freshness: EpgFreshness;
  diagnostic: Record<string, unknown> | null;
};
type AdminEpgResponse = { generatedAt: string; providers: EpgProvider[]; sources: EpgSource[]; refreshRequests: unknown[]; limits: { providers: number; sources: number; refreshRequests: number; assignments: number } };

function isAdminEpgResponse(value: unknown): value is AdminEpgResponse {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { providers?: unknown; sources?: unknown };
  return Array.isArray(candidate.providers) && Array.isArray(candidate.sources);
}

export function AdminEpgOps({ token }: { token: string }) {
  const [data, setData] = useState<AdminEpgResponse | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { setError(''); const result: unknown = await adminRequest('admin-epg-ops', token); if (!isAdminEpgResponse(result)) throw new Error('invalid_epg_response'); setData(result); } catch { setError('EPG operations data is unavailable.'); } }, [token]);
  // The request is an external admin data lifecycle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  return <section className="cloudSimplePanel adminOpsPanel"><header><div><span className="eyebrow">CONTENT OPERATIONS</span><h2>EPG operations</h2><p>Provider coverage, freshness, source health, and affected-device counts.</p></div><button onClick={() => void load()}>Refresh</button></header>
    {error ? <p className="adminError">{error}</p> : null}<div className="adminOpsTable"><div className="adminOpsRow adminOpsHeading"><span>Provider</span><span>Sources</span><span>Devices</span><span>Freshness</span></div>{(data?.providers ?? []).map((provider) => <div className="adminOpsRow" key={provider.id}><span>{provider.name}</span><span>{provider.sourceCount}</span><span>{provider.assignedDeviceCount}</span><span>{provider.freshness?.state ?? 'unknown'}</span></div>)}</div><p className="adminOpsNote">Only safe labels, counts, statuses, and diagnostic categories are shown. Encrypted EPG URLs and tokens remain server-side.</p></section>;
}
