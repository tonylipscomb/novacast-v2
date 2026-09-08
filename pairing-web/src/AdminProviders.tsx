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
  epgMode: 'provider' | 'custom' | 'provider_fallback_custom';
  customEpgUrl: string;
};

const emptyForm: FormState = { displayName: '', baseUrl: '', username: '', password: '', epgMode: 'provider', customEpgUrl: '' };
type EpgResult = Record<string, unknown>;
type EpgSource = {
  id: string;
  sourceKind: 'national' | 'local' | 'sports' | 'fallback';
  safeLabel: string;
  priority: number;
  enabled: boolean;
  urlConfigured: boolean;
  lastRefreshAt: string | null;
  lastRefreshStatus: string | null;
  channelCount: number | null;
  programmeCount: number | null;
  mappedChannels: number | null;
  mappingPercentage: number | null;
  currentProgramCoverage: number | null;
  futureProgramCoverage: number | null;
  activeCacheGeneration: string | null;
  diagnosticSummary: EpgResult | null;
};
type EpgSourceForm = {
  sourceKind: EpgSource['sourceKind'];
  safeLabel: string;
  priority: string;
  enabled: boolean;
  url: string;
};
const emptySourceForm: EpgSourceForm = { sourceKind: 'national', safeLabel: '', priority: '100', enabled: true, url: '' };

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
  const [epgResult, setEpgResult] = useState<EpgResult | null>(null);
  const [mappingAudit, setMappingAudit] = useState<EpgResult | null>(null);
  const [epgTrace, setEpgTrace] = useState<EpgResult | null>(null);
  const [sourceModal, setSourceModal] = useState(false);
  const [sourceEditing, setSourceEditing] = useState<EpgSource | null>(null);
  const [sourceForm, setSourceForm] = useState<EpgSourceForm>(emptySourceForm);
  const [resolutionPreview, setResolutionPreview] = useState<EpgResult | null>(null);

  useEffect(() => {
    if (openCreate) {
      setSelected(null);
      setForm(emptyForm);
      setLiveSummary(null);
      setEpgResult(null);
      setEpgTrace(null);
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
          epgMode: form.epgMode,
          ...(form.customEpgUrl.trim() ? { customEpgUrl: form.customEpgUrl.trim() } : form.epgMode === 'provider' ? { customEpgUrl: null } : {}),
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

  const runEpgAction = async (action: 'test_epg' | 'refresh_epg') => {
    if (!selected?.id || busy) return;
    setBusy(true);
    try {
      const result = await request({ action, id: String(selected.id) });
      setEpgResult((result.epg as EpgResult) ?? null);
      onMessage(action === 'test_epg' ? 'Custom EPG test completed.' : 'Custom EPG refresh completed.');
      await onRefresh();
    } catch (error) {
      const category = error instanceof Error ? error.message : 'admin_request_failed';
      onMessage(`Custom EPG action failed (${friendlyEpgFailure(category)}).`);
    } finally {
      setBusy(false);
    }
  };

  const runEpgTrace = async () => {
    if (!selected?.id || busy) return;
    setBusy(true);
    try {
      const result = await request({ action: 'trace_epg', id: String(selected.id) });
      setEpgTrace((result as EpgResult) ?? null);
      onMessage('Custom EPG trace completed.');
    } catch {
      onMessage('Custom EPG trace failed.');
    } finally {
      setBusy(false);
    }
  };

  const openSourceEditor = (provider: Row, source?: EpgSource) => {
    setSelected(provider);
    setSourceEditing(source ?? null);
    setSourceForm(source ? { sourceKind: source.sourceKind, safeLabel: source.safeLabel, priority: String(source.priority), enabled: source.enabled, url: '' } : emptySourceForm);
    setSourceModal(true);
  };

  const saveSource = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected?.id || busy) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = sourceEditing
        ? { action: 'update_epg_source', sourceId: sourceEditing.id, sourceKind: sourceForm.sourceKind, safeLabel: sourceForm.safeLabel, priority: Number(sourceForm.priority), enabled: sourceForm.enabled }
        : { action: 'create_epg_source', managedProviderId: String(selected.id), sourceKind: sourceForm.sourceKind, safeLabel: sourceForm.safeLabel, priority: Number(sourceForm.priority), enabled: sourceForm.enabled, url: sourceForm.url.trim() };
      if (sourceEditing && sourceForm.url.trim()) body.url = sourceForm.url.trim();
      await request(body);
      setSourceModal(false);
      onMessage(sourceEditing ? 'EPG source updated.' : 'EPG source added.');
      await onRefresh();
    } catch (error) {
      const category = error instanceof Error ? error.message : 'admin_request_failed';
      onMessage(`EPG source could not be saved (${friendlyEpgFailure(category)}).`);
    } finally {
      setBusy(false);
    }
  };

  const runSourceTest = async (source: EpgSource) => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await request({ action: 'test_epg_source', sourceId: source.id });
      setEpgResult((result.epg as EpgResult) ?? null);
      onMessage('EPG source test completed.');
      await onRefresh();
    } catch (error) {
      const category = error instanceof Error ? error.message : 'admin_request_failed';
      onMessage(`EPG source action failed (${friendlyEpgFailure(category)}).`);
    } finally {
      setBusy(false);
    }
  };

  const refreshSource = async (source: EpgSource) => {
    if (busy) return;
    setBusy(true);
    try {
      const started = await request({ action: 'start_epg_refresh', sourceId: source.id });
      const refresh = (started.refresh as EpgResult) ?? null;
      if (!refresh) throw new Error('admin_refresh_job_failed');
      onMessage('EPG source refresh queued for the ingestion worker.');
      await onRefresh();
    } catch (error) {
      const category = error instanceof Error ? error.message : 'admin_request_failed';
      onMessage(`EPG source refresh failed (${friendlyEpgFailure(category)}).`);
    } finally {
      setBusy(false);
    }
  };

  const toggleSource = async (source: EpgSource) => {
    if (busy) return;
    setBusy(true);
    try {
      await request({ action: 'update_epg_source', sourceId: source.id, enabled: !source.enabled });
      onMessage(source.enabled ? 'EPG source disabled.' : 'EPG source enabled.');
      await onRefresh();
    } catch (error) {
      onMessage(`EPG source could not be updated (${error instanceof Error ? error.message : 'admin_request_failed'}).`);
    } finally {
      setBusy(false);
    }
  };

  const deleteSource = async (source: EpgSource) => {
    if (busy || !window.confirm(`Delete EPG source "${source.safeLabel}"?`)) return;
    setBusy(true);
    try {
      await request({ action: 'delete_epg_source', sourceId: source.id });
      onMessage('EPG source deleted.');
      await onRefresh();
    } catch (error) {
      onMessage(`EPG source could not be deleted (${error instanceof Error ? error.message : 'admin_request_failed'}).`);
    } finally {
      setBusy(false);
    }
  };

  const previewResolution = async (provider: Row) => {
    if (!provider.id || busy) return;
    setSelected(provider);
    setBusy(true);
    try {
      const result = await request({ action: 'preview_epg_resolution', managedProviderId: String(provider.id) });
      setResolutionPreview((result.preview as EpgResult) ?? null);
      onMessage('Combined EPG coverage preview completed.');
    } catch (error) {
      onMessage(`Combined EPG preview failed (${error instanceof Error ? error.message : 'admin_request_failed'}).`);
    } finally {
      setBusy(false);
    }
  };

  const runMappingAudit = async (provider: Row, source: EpgSource) => {
    if (!provider.id || busy) return;
    setBusy(true);
    try {
      const result = await request({ action: 'preview_epg_mapping_audit', managedProviderId: String(provider.id), sourceId: source.id });
      setMappingAudit((result.audit as EpgResult) ?? null);
      onMessage('EPG mapping audit completed.');
    } catch (error) {
      onMessage(`EPG mapping audit failed (${error instanceof Error ? error.message : 'admin_request_failed'}).`);
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
                <p>Custom EPG: {provider.custom_url_configured ? 'Configured' : 'Not Configured'}</p>
                <EpgSourcesPanel provider={provider} result={selected?.id === id ? epgResult : null} preview={selected?.id === id ? resolutionPreview : null} mappingAudit={selected?.id === id ? mappingAudit : null} busy={busy} onAdd={() => openSourceEditor(provider)} onEdit={(source) => openSourceEditor(provider, source)} onToggle={(source) => void toggleSource(source)} onTest={(source) => void runSourceTest(source)} onRefresh={(source) => void refreshSource(source)} onDelete={(source) => void deleteSource(source)} onPreview={() => void previewResolution(provider)} onMappingAudit={(source) => void runMappingAudit(provider, source)} />
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
                      setForm({ displayName: String(provider.display_name ?? ''), baseUrl: '', username: '', password: '', epgMode: provider.epg_mode === 'custom' || provider.epg_mode === 'provider_fallback_custom' ? provider.epg_mode : 'provider', customEpgUrl: '' });
                      setLiveSummary(null);
                      setEpgResult(null);
                      setEpgTrace(null);
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
              {modal === 'edit' ? (
                <div className="providerDiagnostics compact">
                  <strong>EPG source</strong>
                  <label><select value={form.epgMode} onChange={(event) => setForm((current) => ({ ...current, epgMode: event.target.value as FormState['epgMode'] }))}><option value="provider">Provider Default</option><option value="custom">Custom XMLTV</option><option value="provider_fallback_custom">Provider + Custom Fallback</option></select></label>
                  <label>Custom XMLTV URL<input value={form.customEpgUrl} onChange={(event) => setForm((current) => ({ ...current, customEpgUrl: event.target.value }))} placeholder={selected?.custom_url_configured ? 'Custom XMLTV URL configured' : 'https://example.com/guide.xml'} autoComplete="off" /></label>
                  <small>Custom EPG: {selected?.custom_url_configured ? 'Configured' : 'Not Configured'}</small>
                  <div className="modalActions">
                    <button type="button" disabled={busy || !selected?.custom_url_configured} onClick={() => void runEpgAction('test_epg')}>Test Feed</button>
                    <button type="button" disabled={busy || !selected?.custom_url_configured} onClick={() => void runEpgAction('refresh_epg')}>Refresh</button>
                    <button type="button" disabled={busy || !selected?.custom_url_configured} onClick={() => void runEpgTrace()}>Trace Feed</button>
                  </div>
                  {epgResult ? <EpgResultPanel result={epgResult} /> : null}
                  {epgTrace ? <EpgTracePanel trace={epgTrace} /> : null}
                </div>
              ) : null}
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
                  <button className="submit" disabled={busy}>{busy ? 'Saving' : 'Save EPG & changes'}</button>
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
      {sourceModal && selected ? (
        <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setSourceModal(false); }}>
          <section className="inviteModal providerModal" role="dialog" aria-modal="true">
            <button className="modalClose" aria-label="Close EPG source editor" disabled={busy} onClick={() => setSourceModal(false)} />
            <span className="eyebrow">EPG SOURCES</span>
            <h2>{sourceEditing ? 'Edit EPG source' : 'Add EPG source'}</h2>
            <p>The URL is encrypted server-side and is never shown after saving.</p>
            <form onSubmit={(event) => void saveSource(event)}>
              <label>Source kind<select value={sourceForm.sourceKind} onChange={(event) => setSourceForm((current) => ({ ...current, sourceKind: event.target.value as EpgSource['sourceKind'] }))}><option value="national">National</option><option value="local">Local</option><option value="sports">Sports</option><option value="fallback">Fallback</option></select></label>
              <label>Safe label<input value={sourceForm.safeLabel} onChange={(event) => setSourceForm((current) => ({ ...current, safeLabel: event.target.value }))} maxLength={120} required placeholder="US national" /></label>
              <label>Priority<input type="number" min="0" max="1000000" value={sourceForm.priority} onChange={(event) => setSourceForm((current) => ({ ...current, priority: event.target.value }))} required /></label>
              <label>Custom XMLTV URL<input value={sourceForm.url} onChange={(event) => setSourceForm((current) => ({ ...current, url: event.target.value }))} placeholder={sourceEditing ? 'Leave blank to keep the saved URL' : 'https://example.com/guide.xml.gz'} autoComplete="off" required={!sourceEditing} /></label>
              <label><input type="checkbox" checked={sourceForm.enabled} onChange={(event) => setSourceForm((current) => ({ ...current, enabled: event.target.checked }))} /> Enabled</label>
              <div className="modalActions"><button type="button" className="ghost" disabled={busy} onClick={() => setSourceModal(false)}>Cancel</button><button type="submit" className="submit" disabled={busy || !sourceForm.safeLabel.trim() || (!sourceEditing && !sourceForm.url.trim())}>{busy ? 'Saving' : 'Save source'}</button></div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function LegacyEpgSourcesPanel({ provider, result, preview, mappingAudit, busy, onAdd, onEdit, onToggle, onTest, onRefresh, onDelete, onPreview, onMappingAudit }: { provider: Row; result: EpgResult | null; preview: EpgResult | null; mappingAudit: EpgResult | null; busy: boolean; onAdd: () => void; onEdit: (source: EpgSource) => void; onToggle: (source: EpgSource) => void; onTest: (source: EpgSource) => void; onRefresh: (source: EpgSource) => void; onDelete: (source: EpgSource) => void; onPreview: () => void; onMappingAudit: (source: EpgSource) => void }) {
  const sources = Array.isArray(provider.epgSources) ? provider.epgSources as EpgSource[] : [];
  return <div className="providerDiagnostics compact"><div className="modalActions"><strong>EPG Sources</strong><button type="button" disabled={busy} onClick={onAdd}>Add source</button><button type="button" disabled={busy || !sources.length} onClick={onPreview}>Preview Combined Coverage</button></div>{sources.length ? sources.map((source) => <div key={source.id} className="providerNote"><strong>{source.safeLabel}</strong> · {source.sourceKind} · priority {source.priority} · {source.enabled ? 'Enabled' : 'Disabled'}<br /><small>Channels: {nullableEpgMetric(source.channelCount)} · Programs: {nullableEpgMetric(source.programmeCount)} · Mapped: {nullableEpgMetric(source.mappedChannels)} · Mapping: {source.mappingPercentage == null ? 'Not recorded' : `${(source.mappingPercentage * 100).toFixed(1)}%`} · Current: {source.currentProgramCoverage == null ? 'Not recorded' : `${(source.currentProgramCoverage * 100).toFixed(1)}%`} · Future: {source.futureProgramCoverage == null ? 'Not recorded' : `${(source.futureProgramCoverage * 100).toFixed(1)}%`}<br />Last refresh: {formatTimestamp(source.lastRefreshAt)} · Status: {source.lastRefreshStatus ?? 'Never'}</small><div className="modalActions"><button type="button" disabled={busy} onClick={() => onEdit(source)}>Edit</button><button type="button" disabled={busy} onClick={() => onToggle(source)}>{source.enabled ? 'Disable' : 'Enable'}</button><button type="button" disabled={busy} onClick={() => onTest(source)}>Test</button><button type="button" disabled={busy} onClick={() => onRefresh(source)}>Refresh</button><button type="button" disabled={busy} onClick={() => onMappingAudit(source)}>Mapping Audit</button><button type="button" disabled={busy} onClick={() => onDelete(source)}>Delete</button></div></div>) : <small>No additional EPG sources configured.</small>}{result ? <EpgResultPanel result={result} /> : null}{mappingAudit ? <EpgMappingAuditPanel result={mappingAudit} /> : null}</div>;
}

function nullableEpgMetric(valueToFormat: unknown, suffix = '') {
  return valueToFormat == null ? 'Not recorded' : `${valueToFormat}${suffix}`;
}

function CombinedCoveragePanel({ preview }: { preview: EpgResult }) {
  const readiness = (preview.readiness ?? {}) as Record<string, unknown>;
  const status = (valueToFormat: unknown) => valueToFormat === true ? 'READY' : valueToFormat === false ? 'NEEDS WORK' : 'NOT RECORDED';
  const reasonText = Array.isArray(readiness.reasons) ? readiness.reasons.map((reason) => String(reason).replace(/_/g, ' ')).join(', ') : 'Not recorded';
  return <div className="providerDiagnostics compact"><strong>Combined coverage preview</strong><p>Overall: {value(preview, 'resolvedChannels')} resolved · {value(preview, 'unresolvedChannels')} unresolved · {value(preview, 'totalProviderChannelsConsidered')} considered · Mapping {preview.mappingPercent == null ? 'Not recorded' : `${(Number(preview.mappingPercent) * 100).toFixed(1)}%`}</p><p>By source: {JSON.stringify(preview.resolvedBySource ?? {})}</p><p>By match: {JSON.stringify(preview.resolvedByMatchType ?? {})}</p><p>US coverage: {nullableEpgMetric(preview.usCombinedResolved)} / {nullableEpgMetric(preview.usRelevantRows)} mapped ({preview.usCombinedMappingPercent == null ? 'Not recorded' : `${Number(preview.usCombinedMappingPercent).toFixed(1)}%`})</p><p>US programmes: current {preview.usCurrentProgrammePercent == null ? 'Not recorded' : `${Number(preview.usCurrentProgrammePercent).toFixed(1)}%`} · future {preview.usFutureProgrammePercent == null ? 'Not recorded' : `${Number(preview.usFutureProgrammePercent).toFixed(1)}%`}</p><p>Sources: EPGenius {nullableEpgMetric(preview.epgeniusOnly)} · US2 {nullableEpgMetric(preview.us2Only)} · Conflicts {nullableEpgMetric(preview.differentTargetConflict)}</p><p>Readiness: Mapping {status(readiness.mappingReady)} · Programme coverage {status(readiness.programmeCoverageReady)} · Conflict safety {status(readiness.conflictRiskAcceptable)} · Managed Guide Delivery {readiness.managedGuideDeliveryReady === true ? 'READY' : readiness.managedGuideDeliveryReady === false ? 'NOT READY' : 'NOT RECORDED'}</p><small>Reasons: {reasonText}</small></div>;
}

function EpgSourcesPanel(props: Parameters<typeof LegacyEpgSourcesPanel>[0]) {
  return <><LegacyEpgSourcesPanel {...props} preview={null} /><>{props.preview ? <CombinedCoveragePanel preview={props.preview} /> : null}</></>;
}

function EpgMappingAuditPanel({ result }: { result: EpgResult }) {
  const groups = (result.groups ?? {}) as Record<string, unknown>;
  const groupRows = (key: string) => { const group = groups[key]; return group && typeof group === 'object' ? String((group as Record<string, unknown>).rows ?? 0) : String(group ?? 0); };
  const potential = ['directIdPotential', 'caseInsensitiveIdPotential', 'exactNamePotential', 'normalizedNamePotential', 'canonicalPotential', 'ambiguousPotential'];
  return <div className="providerDiagnostics compact"><strong>Mapping audit</strong><p>Provider rows: {value(result, 'providerRows')} · Current mapped: {value(result, 'currentMapped')} · Canonical identities: {value(result, 'uniqueProviderCanonicalNames')}</p><p>PRIME: {groupRows('PRIME')} · US: {groupRows('US')} · USA: {groupRows('USA')} · NBA: {groupRows('NBA')} · NFL: {groupRows('NFL')}</p><p>National networks: {groupRows('majorNationalNetworks')} · Likely locals: {groupRows('likelyLocals')} · Foreign: {groupRows('explicitForeign')}</p><p>Additional potential: {value(result, 'additionalDeterministicPotential')} · Projected total: {value(result, 'projectedMappedTotal')} · Ambiguous: {value(result, 'ambiguousPotential')}</p><p>{potential.map((key) => `${key}: ${value(result, key)}`).join(' · ')}</p></div>;
}

function GoldDiagnostic({ account }: { account: Row }) {
  return <div className="providerDiagnostics"><strong>UPSTREAM GOLD ACCOUNT</strong><ul><li><span>Status</span><div><strong>{account.gold_enabled === false ? 'DISABLED' : 'ACTIVE'}</strong></div></li><li><span>Gold User ID</span><div><strong>{String(account.gold_user_id ?? 'Unknown')}</strong></div></li><li><span>Expiration</span><div><strong>{String(account.gold_expiration ?? 'Unknown')}</strong></div></li><li><span>Country</span><div><strong>{String(account.gold_country ?? 'Unknown') === 'ALL' ? 'ALL — VPN / All Countries' : String(account.gold_country ?? 'Unknown')}</strong></div></li><li><span>Last Sync</span><div><strong>{account.last_synced_at ? new Date(String(account.last_synced_at)).toLocaleString() : 'Never'}</strong></div></li><li><span>Route</span><div><strong>{String(account.route_mode ?? account.route_domain ?? 'Not configured')}</strong></div></li></ul><small>Gold account health is separate from Xtream API, stream delivery, route, and NovaCast compatibility health.</small></div>;
}

function canActivateFromSummary(summary: Summary | null) {
  return summary?.overall === 'healthy' || summary?.overall === 'degraded';
}

function friendlyEpgFailure(value: string) {
  const labels: Record<string, string> = { unsafe_url: 'unsafe URL', dns_failure: 'DNS failure', timeout: 'timeout', http_403: 'HTTP 403', http_404: 'HTTP 404', http_5xx: 'provider server error', compressed_response_too_large: 'compressed feed exceeds safe size limit', decompressed_response_too_large: 'decompressed XMLTV exceeds safe size limit', response_too_large: 'feed exceeds safe size limit', WORKER_RESOURCE_LIMIT: 'EPG processing exceeded server resource limits', worker_resource_limit: 'EPG processing exceeded server resource limits', unsupported_compression: 'unsupported compression', invalid_xmltv: 'invalid XMLTV', empty_feed: 'empty feed', parse_failure: 'parse failure' };
  return labels[value] ?? 'request failed';
}

function EpgResultPanelLegacy({ result }: { result: EpgResult }) {
  const value = (key: string) => result[key] == null ? '—' : String(result[key]);
  return <div className="providerDiagnostics compact"><strong>EPG Test Result</strong><p>Status: {result.status === 'success' ? 'Success' : `Failed (${friendlyEpgFailure(String(result.status))})`}</p><p>HTTP: {value('httpStatus')} · Content type: {value('contentType')} · Download: {value('downloadBytes')} bytes</p><p>Channels: {value('xmltvChannels')} · Programs: {value('xmltvPrograms')} · Invalid timestamps: {value('invalidTimestamps')}</p><p>Mapped: {value('mappedChannels')} · Unmatched: {value('unmatchedChannels')} · Current: {value('currentProgramCoverage')} · Future: {value('futureProgramCoverage')}</p><p>Last refresh: {value('lastRefreshAt')}</p></div>;
}

function EpgResultPanelWithSize({ result }: { result: EpgResult }) {
  return <><EpgResultPanelLegacy result={result} /><div className="providerDiagnostics compact"><p>Compressed: {megabytes(result, 'compressedBytes')} · Expanded: {megabytes(result, 'decompressedBytes')}</p></div></>;
}

function EpgResultPanel({ result }: { result: EpgResult }) {
  if (typeof result.jobId === 'string') return <div className="providerDiagnostics compact"><strong>EPG Refresh</strong><p>Status: {String(result.status ?? 'processing')} Â· Stage: {String(result.stage ?? '—')}</p><p>Programs: {String(result.processedProgrammes ?? 0)} / {String(result.totalProgrammes ?? '—')} Â· Progress: {result.progressPercent == null ? '—' : `${String(result.progressPercent)}%`}</p></div>;
  if (result.workerValidationRequired === true) return <div className="providerDiagnostics compact"><strong>EPG Source Test</strong><p>Status: {String(result.status ?? 'network_failure')}</p><p>{result.status === 'reachable' ? 'Source is reachable. Run Refresh for full XMLTV validation.' : 'The source probe did not confirm a usable feed.'}</p><p>HTTP: {result.httpStatus == null ? '—' : String(result.httpStatus)} · Content type: {result.contentType == null ? '—' : String(result.contentType)} · Content length: {result.contentLength == null ? '—' : String(result.contentLength)}</p><p>Host: {result.finalHost == null ? '—' : String(result.finalHost)} · Path: {result.finalPath == null ? '—' : String(result.finalPath)} · Redirects: {String(result.redirectCount ?? 0)}</p></div>;
  return <><EpgResultPanelWithSize result={result} /><EpgMappingPanel result={result} /></>;
}

function EpgMappingPanelLegacy({ result }: { result: EpgResult }) {
  const value = (key: string) => result[key] == null ? 'N/A' : String(result[key]);
  const samples = (key: string) => Array.isArray(result[key]) ? result[key].slice(0, 10).map((row: unknown, index: number) => <li key={index}>{typeof row === 'object' && row !== null ? JSON.stringify(row) : String(row)}</li>) : null;
  return <div className="providerDiagnostics compact"><p>Mapped: {value('mappedChannels')} Â· Unmatched: {value('unmatchedChannels')} Â· Ambiguous: {value('ambiguousChannels')}</p><p>Direct ID: {value('directIdMatches')} Â· Exact name: {value('exactNameMatches')} Â· Normalized name: {value('normalizedNameMatches')}</p><p>Current coverage: {value('currentProgramCoverage')} Â· Future coverage: {value('futureProgramCoverage')}</p>{samples('unmatchedSamples') ? <><strong>Unmatched samples</strong><ul>{samples('unmatchedSamples')}</ul></> : null}{samples('ambiguousSamples') ? <><strong>Ambiguous samples</strong><ul>{samples('ambiguousSamples')}</ul></> : null}</div>;
}

function EpgMappingPanelBase({ result }: { result: EpgResult }) {
  return <><EpgMappingPanelLegacy result={result} /><div className="providerDiagnostics compact"><p>US scoped: {value(result, 'usRelevantProviderChannels')} relevant Â· {value(result, 'usMappedChannels')} mapped Â· {value(result, 'usUnmatchedChannels')} unmatched Â· {value(result, 'usAmbiguousChannels')} ambiguous</p><p>US mapping: {percentage(result, 'usMappingPercentage')} Â· Canonical: {value(result, 'canonicalNameMatches')} Â· Aliases: {value(result, 'aliasMatches')}</p><p>US current coverage: {percentage(result, 'usCurrentProgramCoverage')} Â· Future coverage: {percentage(result, 'usFutureProgramCoverage')}</p>{sampleList(result, 'matchedSamples', 'Matched samples')}{sampleList(result, 'usUnmatchedSamples', 'US unmatched samples')}</div></>;
}

function EpgMappingPanel({ result }: { result: EpgResult }) {
  return <><EpgMappingPanelBase result={result} /><div className="providerDiagnostics compact"><p>Provider scanned: {value(result, 'providerChannelsScanned')} Â· Non-US: {value(result, 'nonUsProviderChannels')}</p><p>Explicit US prefix: {value(result, 'classifiedByUsPrefix')} Â· Explicit non-US prefix: {value(result, 'excludedByNonUsPrefix')} Â· US category: {value(result, 'classifiedByUsCategory')} Â· Non-US category: {value(result, 'excludedByNonUsCategory')} Â· US network heuristic: {value(result, 'classifiedByUsNetworkHeuristic')}</p></div></>;
}

function value(result: EpgResult, key: string) {
  return result[key] == null ? 'N/A' : String(result[key]);
}

function percentage(result: EpgResult, key: string) {
  return result[key] == null ? 'N/A' : `${(Number(result[key]) * 100).toFixed(1)}%`;
}

function sampleList(result: EpgResult, key: string, label: string) {
  if (!Array.isArray(result[key]) || result[key].length === 0) return null;
  return <><strong>{label}</strong><ul>{result[key].slice(0, 10).map((row: unknown, index: number) => <li key={index}>{typeof row === 'object' && row !== null ? JSON.stringify(row) : String(row)}</li>)}</ul></>;
}

function megabytes(result: EpgResult, key: string) {
  return result[key] == null ? 'N/A' : `${(Number(result[key]) / (1024 * 1024)).toFixed(1)} MB`;
}

function EpgTracePanel({ trace }: { trace: EpgResult }) {
  const keys = ['errorCategory', 'requestedHost', 'requestedPath', 'method', 'redirectCount', 'finalHost', 'finalPath', 'status', 'contentType', 'contentLengthHeader', 'serverHeaderPresent', 'locationHeaderPresent'];
  return <div className="providerDiagnostics compact"><strong>EPG Trace</strong>{keys.filter((key) => trace[key] !== undefined).map((key) => <p key={key}>{key}: {trace[key] == null ? '—' : String(trace[key])}</p>)}</div>;
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
