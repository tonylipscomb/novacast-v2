import { FormEvent, useEffect, useMemo, useState } from 'react';

import { adminRequest } from './pairing';
import {
  HEALTH_STEPS,
  canActivateProvider,
  displayHealthLabel,
  formatCount,
  formatTimestamp,
  healthTone,
} from './providerHealthDisplay';

type Row = Record<string, unknown>;
type Summary = {
  overall?: string;
  overallLabel?: string;
  cloudPlaybackProbeRestricted?: boolean;
  cloudPlaybackProbeReason?: string;
  testedAt?: string;
  durationMs?: number;
  checks?: Array<Record<string, unknown>>;
  catalogs?: Record<string, number>;
  probes?: Record<string, { passed?: number; total?: number; averageMs?: number | null }>;
  notes?: string[];
  decoderCaveat?: string;
  account?: Record<string, unknown>;
};

type FormState = {
  displayName: string;
  baseUrl: string;
  username: string;
  password: string;
};

const emptyForm: FormState = { displayName: '', baseUrl: '', username: '', password: '' };

export function AdminProviders({
  token,
  providers,
  onRefresh,
  onMessage,
  openCreate,
  onOpenCreateHandled,
}: {
  token: string;
  providers: Row[];
  onRefresh: () => Promise<void> | void;
  onMessage: (message: string) => void;
  openCreate?: boolean;
  onOpenCreateHandled?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState<'add' | 'edit' | 'diagnostics' | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [liveSummary, setLiveSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (openCreate) {
      setSelected(null);
      setForm(emptyForm);
      setLiveSummary(null);
      setModal('add');
      onOpenCreateHandled?.();
    }
  }, [openCreate, onOpenCreateHandled]);

  useEffect(() => {
    if (!testingId) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [testingId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return providers.filter((provider) => {
      const haystack = `${String(provider.display_name ?? '')} ${String(provider.slug ?? '')} ${String(provider.status ?? '')}`.toLowerCase();
      return !needle || haystack.includes(needle);
    });
  }, [providers, query]);

  const metrics = {
    total: providers.length,
    healthy: providers.filter((provider) => String(provider.health_status ?? '') === 'healthy' && !provider.validation_stale).length,
    failed: providers.filter((provider) => String(provider.health_status ?? '') === 'failed').length,
    draft: providers.filter((provider) => String(provider.status ?? '') === 'draft').length,
  };

  const request = (body: Record<string, unknown>, method: 'POST' | 'PATCH' = 'POST') =>
    adminRequest('admin-providers', token, { method, body: JSON.stringify(body) });

  const runTest = async (id: string) => {
    if (testingId || busy) return;
    setTestingId(id);
    setBusy(true);
    try {
      const result = await request({ action: 'test', id });
      setLiveSummary((result.summary as Summary) ?? null);
      onMessage('Provider health check completed.');
      await onRefresh();
    } catch (error) {
      const category = error instanceof Error ? error.message : 'admin_request_failed';
      onMessage(category === 'validation_in_progress' ? 'A health check is already running for this provider.' : `Health check failed (${category}).`);
      await onRefresh();
    } finally {
      setBusy(false);
      setTestingId(null);
    }
  };

  const probeUnsaved = async () => {
    if (testingId || busy) return;
    setTestingId('new');
    setBusy(true);
    setLiveSummary(null);
    try {
      const result = await request({
        action: 'probe',
        credentials: { baseUrl: form.baseUrl, username: form.username, password: form.password },
      });
      setLiveSummary((result.summary as Summary) ?? null);
      onMessage('Provider test completed. Save as draft or activate only if critical checks passed.');
    } catch (error) {
      const category = error instanceof Error ? error.message : 'admin_request_failed';
      onMessage(`Provider test failed (${category}).`);
    } finally {
      setBusy(false);
      setTestingId(null);
    }
  };

  const saveDraft = async (then: 'draft' | 'test' | 'activate') => {
    if (busy) return;
    setBusy(true);
    if (then !== 'draft') setTestingId('new');
    try {
      await request({
        displayName: form.displayName,
        credentials: { baseUrl: form.baseUrl, username: form.username, password: form.password },
        then,
      });
      onMessage(then === 'activate' ? 'Provider saved and activated.' : then === 'test' ? 'Provider saved and tested.' : 'Provider saved as draft.');
      setModal(null);
      setForm(emptyForm);
      setLiveSummary(null);
      await onRefresh();
    } catch (error) {
      const category = error instanceof Error ? error.message : 'admin_request_failed';
      onMessage(
        category === 'activation_blocked'
          ? 'Provider was saved as draft, but activation is blocked until critical checks pass.'
          : `Could not save provider (${category}).`,
      );
      await onRefresh();
    } finally {
      setBusy(false);
      setTestingId(null);
    }
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected?.id || busy) return;
    setBusy(true);
    try {
      const credentialChanged = Boolean(form.baseUrl.trim() || form.username.trim() || form.password);
      await request(
        {
          action: 'update',
          id: String(selected.id),
          displayName: form.displayName,
          ...(credentialChanged
            ? {
                credentials: {
                  ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
                  ...(form.username.trim() ? { username: form.username.trim() } : {}),
                  ...(form.password ? { password: form.password } : {}),
                },
              }
            : {}),
        },
        'PATCH',
      );
      onMessage(form.password || form.baseUrl ? 'Provider updated. Validation required before activation changes.' : 'Provider details updated.');
      setModal(null);
      await onRefresh();
    } catch (error) {
      const category = error instanceof Error ? error.message : 'admin_request_failed';
      onMessage(`Provider could not be updated (${category}).`);
    } finally {
      setBusy(false);
    }
  };

  const activate = async (id: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await request({ action: 'activate', id });
      onMessage('Provider activated for NovaCast devices.');
      await onRefresh();
    } catch (error) {
      const category = error instanceof Error ? error.message : 'admin_request_failed';
      onMessage(category === 'activation_blocked' ? 'Activation blocked until a successful health check.' : `Could not activate provider (${category}).`);
    } finally {
      setBusy(false);
    }
  };

  const disable = async (id: string) => {
    if (busy) return;
    if (!window.confirm('Disable this provider for beta devices? Configuration and diagnostics will be kept.')) return;
    setBusy(true);
    try {
      await request({ action: 'disable', id });
      onMessage('Provider disabled. It remains visible in Admin and can be retested.');
      await onRefresh();
    } catch (error) {
      const category = error instanceof Error ? error.message : 'admin_request_failed';
      onMessage(`Could not disable provider (${category}).`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="providersPage">
      <section className="inviteHero">
        <div className="inviteHeroCopy">
          <div className="inviteIcon">P</div>
          <div>
            <h2>Managed providers</h2>
            <p>Add Xtream providers, validate catalogs and playback endpoints, then activate only when safe.</p>
            <p>Draft providers stay hidden from beta devices until a passing health check and explicit activation.</p>
          </div>
        </div>
        <div className="inviteHeroMetrics">
          <MiniMetric label="TOTAL PROVIDERS" value={metrics.total} detail="Configured packages" tone="blue" />
          <MiniMetric label="HEALTHY" value={metrics.healthy} detail="Ready for activation" tone="green" />
          <MiniMetric label="NEEDS ATTENTION" value={metrics.failed + metrics.draft} detail={`${metrics.failed} failed · ${metrics.draft} draft`} tone="purple" />
        </div>
      </section>

      <section className="inviteFilters">
        <label className="inviteSearch">
          <span />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search providers" />
        </label>
        <button className="filterButton" onClick={() => setQuery('')}>Clear</button>
        <button
          className="cloudPrimary"
          onClick={() => {
            setSelected(null);
            setForm(emptyForm);
            setLiveSummary(null);
            setModal('add');
          }}
        >
          Add Provider
        </button>
      </section>

      {filtered.length ? (
        <div className="providerCardGrid">
          {filtered.map((provider) => {
            const id = String(provider.id ?? '');
            const activation = String(provider.status ?? 'draft');
            const health = String(provider.health_status ?? 'unvalidated');
            const stale = Boolean(provider.validation_stale);
            const label = displayHealthLabel({ activationStatus: activation, healthStatus: health, validationStale: stale });
            const eligible = canActivateProvider({ healthStatus: health, validationStale: stale, activationStatus: activation });
            const summary = (provider.last_health_summary ?? null) as Summary | null;
            const testing = testingId === id;
            return (
              <article key={id} className={`providerCard tone-${healthTone(label)}`}>
                <header>
                  <div>
                    <strong>{String(provider.display_name ?? provider.slug ?? 'Managed provider')}</strong>
                    <small>Xtream · {provider.goldAccount ? 'Gold Managed' : activation === 'active' ? 'Enabled' : activation === 'paused' || activation === 'revoked' ? 'Disabled' : 'Not served to devices'}</small>
                  </div>
                  <b className={`providerBadge badge-${healthTone(label)}`}>{label}</b>
                </header>
                <dl>
                  <div><span>Live TV</span><strong>{formatCount(provider.live_channel_count)}</strong></div>
                  <div><span>Movies</span><strong>{formatCount(provider.movie_count)}</strong></div>
                  <div><span>Series</span><strong>{formatCount(provider.series_count)}</strong></div>
                </dl>
                <p>Last tested: {formatTimestamp(provider.last_tested_at)}</p>
                <p>Last successful: {formatTimestamp(provider.last_successful_test_at)}</p>
                {provider.goldAccount ? <p className="providerNote">Gold: {String((provider.goldAccount as Row).gold_country ?? '—') === 'ALL' ? 'ALL — VPN / All Countries' : String((provider.goldAccount as Row).gold_country ?? '—')} · expires {String((provider.goldAccount as Row).gold_expiration ?? 'unknown')}</p> : null}
                {summary?.overallLabel ? <p className="providerNote">{String(summary.overallLabel)}</p> : null}
                {summary?.cloudPlaybackProbeRestricted ? <p className="providerNote">Cloud playback probe restricted. Device playback test recommended.</p> : null}
                {testing ? <ProgressPanel elapsed={elapsed} /> : null}
                <footer>
                  <button disabled={busy} onClick={() => void runTest(id)}>{testing ? 'Testing…' : 'Retest'}</button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setSelected(provider);
                      setLiveSummary(summary);
                      setModal('diagnostics');
                    }}
                  >
                    Diagnostics
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      setSelected(provider);
                      setForm({ displayName: String(provider.display_name ?? ''), baseUrl: '', username: '', password: '' });
                      setLiveSummary(null);
                      setModal('edit');
                    }}
                  >
                    Edit
                  </button>
                  {activation === 'active' ? (
                    <button className="dangerButton" disabled={busy} onClick={() => void disable(id)}>Disable</button>
                  ) : (
                    <button disabled={busy || !eligible} onClick={() => void activate(id)} title={eligible ? 'Activate for beta devices' : 'Requires a passing health check'}>
                      Activate
                    </button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="inviteEmpty">
          <div>P</div>
          <strong>{providers.length ? 'No providers match your search.' : 'No managed providers yet'}</strong>
          <small>Add a provider, test it, then activate it only after critical checks pass.</small>
          <button onClick={() => setModal('add')}>Add Provider</button>
        </section>
      )}

      {modal === 'add' || modal === 'edit' ? (
        <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setModal(null); }}>
          <section className="inviteModal providerModal" role="dialog" aria-modal="true">
            <button className="modalClose" aria-label="Close" disabled={busy} onClick={() => setModal(null)} />
            <span className="eyebrow">NOVACAST CLOUD ADMIN</span>
            <h2>{modal === 'add' ? 'Add provider' : 'Edit provider'}</h2>
            <p>
              {modal === 'add'
                ? 'Save as draft first. Activation stays blocked until a health check passes.'
                : 'Changing server or credentials marks previous validation stale.'}
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (modal === 'edit') void saveEdit(event);
                else void saveDraft('draft');
              }}
            >
              <label>
                Provider display name
                <input value={form.displayName} onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))} required placeholder="Nova Streams" />
              </label>
              <label>
                Provider type
                <select value="xtream" disabled>
                  <option value="xtream">Xtream Codes</option>
                </select>
              </label>
              <label>
                Server / Portal URL
                <input value={form.baseUrl} onChange={(event) => setForm((current) => ({ ...current, baseUrl: event.target.value }))} placeholder="http://example.com:8080" required={modal === 'add'} />
              </label>
              <label>
                Username
                <input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} autoComplete="off" required={modal === 'add'} />
              </label>
              <label>
                Password
                <input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} autoComplete="new-password" required={modal === 'add'} placeholder={modal === 'edit' ? 'Leave blank to keep the saved password' : ''} />
              </label>
              {testingId === 'new' ? <ProgressPanel elapsed={elapsed} /> : null}
              {liveSummary ? <DiagnosticsBody summary={liveSummary} compact /> : null}
              <div className="modalActions">
                <button type="button" className="ghost" disabled={busy} onClick={() => setModal(null)}>Cancel</button>
                {modal === 'add' ? (
                  <>
                    <button type="button" disabled={busy || !form.baseUrl || !form.username || !form.password} onClick={() => void probeUnsaved()}>
                      Test Provider
                    </button>
                    <button type="submit" disabled={busy || !form.displayName}>{busy ? 'Saving' : 'Save as Draft'}</button>
                    <button
                      type="button"
                      className="submit"
                      disabled={busy || !canActivateFromSummary(liveSummary)}
                      onClick={() => void saveDraft('activate')}
                    >
                      Save & Activate
                    </button>
                  </>
                ) : (
                  <button className="submit" disabled={busy}>{busy ? 'Saving' : 'Save changes'}</button>
                )}
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {modal === 'diagnostics' && selected ? (
        <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
          <section className="inviteModal providerModal" role="dialog" aria-modal="true">
            <button className="modalClose" aria-label="Close diagnostics" onClick={() => setModal(null)} />
            <span className="eyebrow">PROVIDER DIAGNOSTICS</span>
            <h2>{String(selected.display_name ?? 'Managed provider')}</h2>
            <p>Stream Probe checks endpoint media viability. Decoder compatibility is still proven on a NovaCast device.</p>
            {selected.goldAccount ? <GoldDiagnostic account={selected.goldAccount as Row} /> : null}
            <DiagnosticsBody summary={(liveSummary ?? selected.last_health_summary) as Summary | null} />
            <div className="modalActions">
              <button type="button" className="ghost" onClick={() => setModal(null)}>Close</button>
              <button type="button" disabled={busy} onClick={() => void runTest(String(selected.id))}>Retest</button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function GoldDiagnostic({ account }: { account: Row }) {
  return <div className="providerDiagnostics"><strong>UPSTREAM GOLD ACCOUNT</strong><ul><li><span>Status</span><div><strong>{account.gold_enabled === false ? 'DISABLED' : 'ACTIVE'}</strong></div></li><li><span>Gold User ID</span><div><strong>{String(account.gold_user_id ?? 'Unknown')}</strong></div></li><li><span>Expiration</span><div><strong>{String(account.gold_expiration ?? 'Unknown')}</strong></div></li><li><span>Country</span><div><strong>{String(account.gold_country ?? 'Unknown') === 'ALL' ? 'ALL — VPN / All Countries' : String(account.gold_country ?? 'Unknown')}</strong></div></li><li><span>Last Sync</span><div><strong>{account.last_synced_at ? new Date(String(account.last_synced_at)).toLocaleString() : 'Never'}</strong></div></li><li><span>Route</span><div><strong>{String(account.route_mode ?? account.route_domain ?? 'Not configured')}</strong></div></li></ul><small>Gold account health is separate from Xtream API, stream delivery, route, and NovaCast compatibility health.</small></div>;
}

function canActivateFromSummary(summary: Summary | null) {
  return summary?.overall === 'healthy' || summary?.overall === 'degraded';
}

function MiniMetric({ label, value, detail, tone }: { label: string; value: number; detail: string; tone: string }) {
  return (
    <div className={`inviteMetric tone-${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      <i />
    </div>
  );
}

function ProgressPanel({ elapsed }: { elapsed: number }) {
  return (
    <div className="providerProgress">
      <strong>Testing Provider</strong>
      <small>Server-side checks are running. This panel stays interactive; additional tests are blocked until this run finishes. {elapsed}s elapsed.</small>
      <ol>
        {HEALTH_STEPS.map((step) => (
          <li key={step.id}><i />{step.label}</li>
        ))}
      </ol>
    </div>
  );
}

function DiagnosticsBody({ summary, compact = false }: { summary: Summary | null; compact?: boolean }) {
  if (!summary) return <p className="providerNote">No health check has been recorded yet.</p>;
  const checks = Array.isArray(summary.checks) ? summary.checks : [];
  return (
    <div className={`providerDiagnostics ${compact ? 'compact' : ''}`}>
      <div className={`providerBadge badge-${healthTone(String(summary.overall ?? '').toUpperCase())}`}>
        OVERALL {String(summary.overall ?? 'unknown').toUpperCase()}
      </div>
      {summary.overallLabel ? <p>{summary.overallLabel}</p> : null}
      {summary.cloudPlaybackProbeRestricted ? <p>Xtream authentication and catalogs passed, but server-side playback probes were restricted. Device playback test recommended.</p> : null}
      <ul>
        {checks.map((check) => {
          const verdict = String(check.verdict ?? 'skip');
          const mark = verdict === 'pass' ? '✓' : verdict === 'warn' ? '⚠' : verdict === 'fail' ? '✕' : '○';
          return (
            <li key={String(check.id)}>
              <span>{mark}</span>
              <div>
                <strong>{String(check.label ?? check.id)}</strong>
                <small>{String(check.detail ?? '')}{check.latencyMs ? ` · ${check.latencyMs} ms` : ''}</small>
              </div>
            </li>
          );
        })}
      </ul>
      {summary.probes ? (
        <p>
          Stream Probe: Live {summary.probes.live?.passed ?? 0}/{summary.probes.live?.total ?? 0}
          {' · '}Movies {summary.probes.movies?.passed ?? 0}/{summary.probes.movies?.total ?? 0}
          {' · '}Episodes {summary.probes.episodes?.passed ?? 0}/{summary.probes.episodes?.total ?? 0}
        </p>
      ) : null}
      {Array.isArray(summary.notes) && summary.notes.length ? (
        <ul>
          {summary.notes
            .filter((note) => note && note !== summary.decoderCaveat)
            .slice(0, 16)
            .map((note, index) => (
              <li key={`${index}-${note}`}><small>{note}</small></li>
            ))}
        </ul>
      ) : null}
      {summary.decoderCaveat ? <small>{summary.decoderCaveat}</small> : null}
    </div>
  );
}
