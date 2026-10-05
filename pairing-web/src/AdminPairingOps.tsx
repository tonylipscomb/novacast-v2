import { useCallback, useEffect, useState } from 'react';
import { adminRequest } from './pairing';

type Props = { token: string };
type Session = { id: string; state: string; createdAt: string; expiresAt: string; providerName?: string | null; failureCategory?: string | null; validationAttempts: number };

export function AdminPairingOps({ token }: Props) {
  const [data, setData] = useState<{ summary?: { states?: Record<string, number>; last24Hours?: Record<string, number> }; sessions?: Session[]; total?: number } | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { setError(''); setData(await adminRequest(`admin-pairing-ops?page=${page}&pageSize=25`, token)); } catch { setError('Pairing operations data is unavailable.'); } }, [page, token]);
  // The request is an external admin data lifecycle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const states = data?.summary?.states ?? {};
  return <section className="cloudSimplePanel adminOpsPanel">
    <header><div><span className="eyebrow">OPERATIONS</span><h2>Pairing operations</h2><p>Bounded, sanitized pairing session health and recent outcomes.</p></div><button onClick={() => void load()}>Refresh</button></header>
    {error ? <p className="adminError">{error}</p> : null}
    <div className="adminOpsCards">{['pending', 'completed', 'expired', 'failed'].map((key) => <div className="adminOpsCard" key={key}><small>{key}</small><strong>{states[key] ?? 0}</strong></div>)}</div>
    <p className="adminOpsNote">Last 24h: {data?.summary?.last24Hours?.completed ?? 0} completed · {data?.summary?.last24Hours?.failures ?? 0} failures. Pairing codes, redemption material, credentials, and rate-limit keys are never returned.</p>
    <div className="adminOpsTable"><div className="adminOpsRow adminOpsHeading"><span>Session</span><span>State</span><span>Provider</span><span>Failure</span></div>{(data?.sessions ?? []).map((session) => <div className="adminOpsRow" key={session.id}><span>{session.id.slice(0, 8)}…</span><span>{session.state}</span><span>{session.providerName ?? '—'}</span><span>{session.failureCategory ?? '—'}</span></div>)}</div>
    <footer className="adminPager"><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</button><span>Page {page} · {data?.total ?? 0} sessions</span><button disabled={(data?.sessions?.length ?? 0) < 25} onClick={() => setPage((value) => value + 1)}>Next</button></footer>
  </section>;
}
