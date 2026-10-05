import { FormEvent, useEffect, useState } from 'react';

import { adminRequest } from './pairing';
import {
  HEALTH_STEPS,
  canActivateProvider,
  displayHealthLabel,
  formatCount,
  formatTimestamp,
  healthTone,
  isCappedCatalogCount,
  formatInventoryCount,
} from './providerHealthDisplay';

type Row = Record<string, unknown>;
type CatalogSummary = {
  liveCategories?: number;
  liveChannels?: number;
  movieCategories?: number;
  movies?: number;
  seriesCategories?: number;
  series?: number;
  countDetails?: {
    liveChannels?: { exactCountAvailable?: boolean };
    movies?: { exactCountAvailable?: boolean };
    series?: { exactCountAvailable?: boolean };
  };
  truncated?: { liveChannels?: boolean; movies?: boolean; series?: boolean };
};
type Summary = {
  overall?: string;
  overallLabel?: string;
  cloudPlaybackProbeRestricted?: boolean;
  cloudPlaybackProbeReason?: string;
  testedAt?: string;
  durationMs?: number;
  checks?: Array<Record<string, unknown>>;
  catalogs?: CatalogSummary;
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
type EpgWizardStep = 'overview' | 'source' | 'coverage' | 'audit';
type ProviderQuery = { page: number; pageSize: number; search: string; health: string; type: string; managed: string; gold: string };
type ProviderPagination = { page: number; pageSize: number; total: number; totalPages: number; summary: Record<string, number> };
const emptySourceForm: EpgSourceForm = { sourceKind: 'national', safeLabel: '', priority: '100', enabled: true, url: '' };
const PROVIDER_VALIDATION_LEASE_MS = 3 * 60 * 1000;

export function AdminProviders({
  token,
  providers,
  onRefresh,
  onMessage,
  pagination,
  query: serverQuery,
  onQueryChange,
  openCreate,
  onOpenCreateHandled,
}: {
  token: string;
  providers: Row[];
  onRefresh: () => Promise<void> | void;
  onMessage: (message: string) => void;
  pagination: ProviderPagination;
  query: ProviderQuery;
  onQueryChange: (query: ProviderQuery) => void;
  openCreate?: boolean;
  onOpenCreateHandled?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [healthFilter, setHealthFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [managedFilter, setManagedFilter] = useState('all');
  const [goldFilter, setGoldFilter] = useState('all');
  const [modal, setModal] = useState<'add' | 'edit' | 'diagnostics' | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testingStartedAt, setTestingStartedAt] = useState<string | null>(null);
  const [failedTestingId, setFailedTestingId] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [liveSummary, setLiveSummary] = useState<Summary | null>(null);
  const [epgResult, setEpgResult] = useState<EpgResult | null>(null);
  const [mappingAudit, setMappingAudit] = useState<EpgResult | null>(null);
  const [epgTrace, setEpgTrace] = useState<EpgResult | null>(null);
  const [sourceModal, setSourceModal] = useState(false);
  const [sourceEditing, setSourceEditing] = useState<EpgSource | null>(null);
  const [sourceForm, setSourceForm] = useState<EpgSourceForm>(emptySourceForm);
  const [resolutionPreview, setResolutionPreview] = useState<EpgResult | null>(null);
  const [epgWizardStep, setEpgWizardStep] = useState<EpgWizardStep | null>(null);
  const [epgWizardSource, setEpgWizardSource] = useState<EpgSource | null>(null);
  const [, setLeaseTick] = useState(0);

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
    const persistedTestingProvider = providers.find((provider) => {
      const id = String(provider.id ?? '');
      return id !== failedTestingId && String(provider.health_status ?? '') === 'testing' && isFreshProviderValidationLease(provider);
    });
    const elapsedRunKey = testingId ?? String(persistedTestingProvider?.id ?? '');
    const startedAt = testingId ? testingStartedAt : String(persistedTestingProvider?.updated_at ?? '');
    const startedMs = Date.parse(startedAt ?? '');
    if (!elapsedRunKey || !Number.isFinite(startedMs)) {
      setElapsed(0);
      return;
    }
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedMs) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [failedTestingId, providers, testingId, testingStartedAt]);

  useEffect(() => {
    if (!providers.some((provider) => String(provider.health_status ?? '') === 'testing')) return;
    const timer = window.setInterval(() => setLeaseTick((valueToIncrement) => valueToIncrement + 1), 10_000);
    return () => window.clearInterval(timer);
  }, [providers]);

  const notifyQuery = (patch: Partial<ProviderQuery>) => onQueryChange({ ...serverQuery, ...patch, page: 1 });
  const filtered = providers;

  const metrics = {
    total: pagination.total,
    healthy: pagination.summary.healthy ?? 0,
    failed: pagination.summary.failed ?? 0,
    draft: providers.filter((provider) => String(provider.status ?? '') === 'draft').length,
  };

  const request = (body: Record<string, unknown>, method: 'POST' | 'PATCH' = 'POST') =>
    adminRequest('admin-providers', token, { method, body: JSON.stringify(body) });

  const runTest = async (id: string) => {
    if (testingId || busy) return;
    setFailedTestingId(null);
    setTestingId(id);
    setTestingStartedAt(new Date().toISOString());
    setBusy(true);
    try {
      const result = await request({ action: 'test', id });
      setLiveSummary((result.summary as Summary) ?? null);
      onMessage('Provider health check completed.');
      await onRefresh();
    } catch (error) {
      setFailedTestingId(id);
      const category = error instanceof Error ? error.message : 'admin_request_failed';
      onMessage(category === 'validation_in_progress' ? 'Provider validation is already running.' : `Health check failed (${category}).`);
      await onRefresh();
    } finally {
      setBusy(false);
      setTestingId(null);
      setTestingStartedAt(null);
    }
  };

  const probeUnsaved = async () => {
    if (testingId || busy) return;
    setFailedTestingId(null);
    setTestingId('new');
    setTestingStartedAt(new Date().toISOString());
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
      setTestingStartedAt(null);
    }
  };

  const saveDraft = async (then: 'draft' | 'test' | 'activate') => {
    if (busy) return;
    setBusy(true);
    if (then !== 'draft') {
      setFailedTestingId(null);
      setTestingId('new');
      setTestingStartedAt(new Date().toISOString());
    }
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
      setTestingStartedAt(null);
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
  const wizardProvider = selected ? providers.find((provider) => String(provider.id) === String(selected.id)) ?? selected : null;

  const openEpgWizard = (provider: Row) => {
    setSelected(provider);
    setEpgWizardSource(null);
    setEpgWizardStep('overview');
    setResolutionPreview(null);
    setMappingAudit(null);
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
      setEpgWizardStep('coverage');
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
      setEpgWizardSource(source);
      setEpgWizardStep('audit');
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
          <input value={query} onChange={(event) => { setQuery(event.target.value); notifyQuery({ search: event.target.value }); }} placeholder="Search providers, IDs, or devices" />
        </label>
        <select value={healthFilter} onChange={(event) => { setHealthFilter(event.target.value); notifyQuery({ health: event.target.value }); }} aria-label="Filter providers by health">
          <option value="all">All health states</option>
          {['healthy', 'degraded', 'failed', 'testing', 'unvalidated'].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); notifyQuery({ type: event.target.value }); }} aria-label="Filter providers by type"><option value="all">All types</option><option value="xtream">Xtream</option></select>
        <select value={managedFilter} onChange={(event) => { setManagedFilter(event.target.value); notifyQuery({ managed: event.target.value }); }} aria-label="Filter providers by source"><option value="all">All sources</option><option value="managed">Managed</option></select>
        <select value={goldFilter} onChange={(event) => { setGoldFilter(event.target.value); notifyQuery({ gold: event.target.value }); }} aria-label="Filter providers by Gold status"><option value="all">All Gold states</option><option value="gold">Gold linked</option><option value="non_gold">Not Gold linked</option></select>
        <button className="filterButton" onClick={() => { setQuery(''); setHealthFilter('all'); setTypeFilter('all'); setManagedFilter('all'); setGoldFilter('all'); onQueryChange({ ...serverQuery, page: 1, search: '', health: 'all', type: 'all', managed: 'all', gold: 'all' }); }}>Clear</button>
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
            const eligible = canActivateProvider({ healthStatus: health, validationStale: stale, activationStatus: activation });
            const summary = (provider.last_health_summary ?? null) as Summary | null;
            const catalogTruncated = summary?.catalogs?.truncated ?? {};
            const catalogDetails = summary?.catalogs?.countDetails ?? {};
            const authenticationCheck = summary?.checks?.find((check) => String(check.id) === 'authentication');
            const serverCheck = summary?.checks?.find((check) => String(check.id) === 'server');
            const expired = Boolean(summary?.account?.expiresAt && Date.parse(String(summary.account.expiresAt)) <= Date.now());
            const offline = health === 'failed' && (authenticationCheck?.verdict === 'fail' || serverCheck?.verdict === 'fail') && !expired;
            const testingLeaseFresh = health === 'testing' && id !== failedTestingId && isFreshProviderValidationLease(provider);
            const testing = testingId === id || testingLeaseFresh;
            const label = displayHealthLabel({ activationStatus: activation, healthStatus: health, validationStale: stale, testingLeaseFresh, expired, offline });
            const healthToneLabel = healthTone(label);
            return (
              <article key={id} className={`providerCard tone-${healthToneLabel}`}>
                <header>
                  <div>
                    <strong>{String(provider.display_name ?? provider.slug ?? 'Managed provider')}</strong>
                    <small>Xtream · {provider.goldAccount ? 'Gold Managed' : activation === 'active' ? 'Enabled' : activation === 'paused' || activation === 'revoked' ? 'Disabled' : 'Not served to devices'}</small>
                  </div>
                  <b className={`providerBadge badge-${healthToneLabel}`}>{label}</b>
                </header>
                <dl>
                  <div><span>Live TV</span><strong>{formatInventoryCount(provider.inventory_live_count, provider.live_channel_count, isCappedCatalogCount(provider.live_channel_count, catalogTruncated.liveChannels, catalogDetails.liveChannels?.exactCountAvailable))}</strong></div>
                  <div><span>Movies</span><strong>{formatInventoryCount(provider.inventory_movie_count, provider.movie_count, isCappedCatalogCount(provider.movie_count, catalogTruncated.movies, catalogDetails.movies?.exactCountAvailable))}</strong></div>
                  <div><span>Series</span><strong>{formatInventoryCount(provider.inventory_series_count, provider.series_count, isCappedCatalogCount(provider.series_count, catalogTruncated.series, catalogDetails.series?.exactCountAvailable))}</strong></div>
                </dl>
                <p>Provider ID: <code>{id}</code> · Assigned devices: {Number(provider.assignedDevices ?? 0)}</p>
                {Array.isArray(provider.assignedDeviceSamples) && provider.assignedDeviceSamples.length ? <p className="providerNote">Devices: {provider.assignedDeviceSamples.slice(0, 3).map((device: Row) => String(device.friendly_name ?? device.public_device_code ?? 'Device')).join(' · ')}{Number(provider.assignedDevices ?? 0) > 3 ? ' · …' : ''}</p> : null}
                <p>Last tested: {formatTimestamp(provider.last_tested_at)}</p>
                <p>Last successful: {formatTimestamp(provider.last_successful_test_at)}</p>
                <div className="providerHealthSignals">
                  <SignalRow label="API" value={checkLabel(authenticationCheck)} />
                  <SignalRow label="Catalog" value={catalogLabel(summary)} />
                  <SignalRow label="Cloud playback" value={summary?.cloudPlaybackProbeRestricted ? 'Restricted · Device verify' : probeLabel(summary)} />
                  <SignalRow label="Device playback" value="Not verified" />
                </div>
                <p>Custom EPG: {provider.custom_url_configured ? 'Configured' : 'Not Configured'}</p>
                <EpgSummaryButton provider={provider} onClick={() => openEpgWizard(provider)} />
                {provider.goldAccount ? <p className="providerNote">Gold panel: {String((provider.goldAccount as Row).gold_country ?? '—') === 'ALL' ? 'ALL — VPN / All Countries' : String((provider.goldAccount as Row).gold_country ?? '—')} · expiry {String((provider.goldAccount as Row).gold_expiration ?? 'unknown')} · synced {formatTimestamp((provider.goldAccount as Row).last_synced_at)}</p> : null}
                {summary?.account?.expiresAt ? <p className="providerNote">Latest API expiry: {formatTimestamp(summary.account.expiresAt)} · from test {formatTimestamp(summary.testedAt)}</p> : null}
                {summary?.overallLabel ? <p className="providerNote">{String(summary.overallLabel)}</p> : null}
                {testing ? <ProgressPanel elapsed={elapsed} /> : null}
                <footer>
                  <button disabled={busy || testingLeaseFresh} onClick={() => void runTest(id)}>{testing ? 'Testing…' : 'Retest'}</button>
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
          <strong>{pagination.total ? 'No providers match your search.' : 'No managed providers yet'}</strong>
          <small>Add a provider, test it, then activate it only after critical checks pass.</small>
          <button onClick={() => setModal('add')}>Add Provider</button>
        </section>
      )}

      <footer className="invitePagination">
        <span>Showing {pagination.total ? (pagination.page - 1) * pagination.pageSize + 1 : 0} to {Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total} providers</span>
        <div>
          <button disabled={pagination.page <= 1} onClick={() => onQueryChange({ ...serverQuery, page: pagination.page - 1 })}>Previous</button>
          <strong>{pagination.page}</strong>
          <button disabled={pagination.page >= Math.max(1, pagination.totalPages)} onClick={() => onQueryChange({ ...serverQuery, page: pagination.page + 1 })}>Next</button>
        </div>
      </footer>

      {epgWizardStep && wizardProvider ? (
        <EpgWizard
          provider={wizardProvider}
          step={epgWizardStep}
          source={epgWizardSource}
          preview={resolutionPreview}
          audit={mappingAudit}
          busy={busy}
          onClose={() => setEpgWizardStep(null)}
          onStep={setEpgWizardStep}
          onAdd={() => openSourceEditor(wizardProvider)}
          onManage={(source) => { setEpgWizardSource(source); setEpgWizardStep('source'); }}
          onEdit={(source) => openSourceEditor(wizardProvider, source)}
          onToggle={(source) => void toggleSource(source)}
          onTest={(source) => void runSourceTest(source)}
          onRefresh={(source) => void refreshSource(source)}
          onDelete={(source) => void deleteSource(source)}
          onPreview={() => void previewResolution(wizardProvider)}
          onMappingAudit={(source) => void runMappingAudit(wizardProvider, source)}
        />
      ) : null}

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

function EpgSummaryButton({ provider, onClick }: { provider: Row; onClick: () => void }) {
  const sources = Array.isArray(provider.epgSources) ? provider.epgSources as EpgSource[] : [];
  const enabled = sources.filter((source) => source.enabled).length;
  const mapped = sources.reduce((total, source) => total + (source.mappedChannels ?? 0), 0);
  const latestRefresh = sources.map((source) => source.lastRefreshAt).filter(Boolean).sort().at(-1) ?? null;
  return <button type="button" className="providerEpgSummary" onClick={onClick}><span><strong>EPG</strong><small>{sources.length} source{sources.length === 1 ? '' : 's'} · {enabled} enabled · {mapped ? `${mapped.toLocaleString()} mapped` : 'Mapping not recorded'}{latestRefresh ? ` · ${formatTimestamp(latestRefresh)}` : ''}</small></span><b>Manage EPG</b></button>;
}

function EpgWizard({ provider, step, source, preview, audit, busy, onClose, onStep, onAdd, onManage, onEdit, onToggle, onTest, onRefresh, onDelete, onPreview, onMappingAudit }: {
  provider: Row;
  step: EpgWizardStep;
  source: EpgSource | null;
  preview: EpgResult | null;
  audit: EpgResult | null;
  busy: boolean;
  onClose: () => void;
  onStep: (step: EpgWizardStep) => void;
  onAdd: () => void;
  onManage: (source: EpgSource) => void;
  onEdit: (source: EpgSource) => void;
  onToggle: (source: EpgSource) => void;
  onTest: (source: EpgSource) => void;
  onRefresh: (source: EpgSource) => void;
  onDelete: (source: EpgSource) => void;
  onPreview: () => void;
  onMappingAudit: (source: EpgSource) => void;
}) {
  const sources = Array.isArray(provider.epgSources) ? provider.epgSources as EpgSource[] : [];
  const enabled = sources.filter((item) => item.enabled).length;
  const mapped = sources.reduce((total, item) => total + (item.mappedChannels ?? 0), 0);
  const latestRefresh = sources.map((item) => item.lastRefreshAt).filter(Boolean).sort().at(-1) ?? null;
  const title = step === 'overview' ? 'Manage EPG' : step === 'source' ? source?.safeLabel ?? 'EPG source' : step === 'coverage' ? 'Combined coverage' : 'Mapping audit';
  return <div className="modalBackdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="inviteModal epgWizardModal" role="dialog" aria-modal="true">
      <button className="modalClose" aria-label="Close EPG manager" disabled={busy} onClick={onClose} />
      <span className="eyebrow">EPG MANAGEMENT · {String(provider.display_name ?? 'Provider')}</span>
      <h2>{title}</h2>
      {step === 'overview' ? <>
        <strong>EPG Sources</strong>
        <div className="epgWizardSummary"><span>Sources <strong>{sources.length}</strong></span><span>Enabled <strong>{enabled}</strong></span><span>Mapped <strong>{mapped.toLocaleString()}</strong></span><span>Last refresh <strong>{latestRefresh ? formatTimestamp(latestRefresh) : 'Never'}</strong></span></div>
        <div className="epgWizardActions epgWizardToolbar"><button type="button" className="epgPrimaryAction" disabled={busy} onClick={onAdd}>Add source</button><button type="button" aria-label="Preview Combined Coverage" className="epgSecondaryAction" disabled={busy || !sources.length} onClick={onPreview}>Coverage</button></div>
        <div className="epgWizardSourceList">{sources.length ? sources.map((item) => <div className="epgWizardSourceRow" key={item.id}><div><strong>{item.safeLabel}</strong><small>{item.sourceKind} · Priority {item.priority} · {item.enabled ? 'Enabled' : 'Disabled'}</small><small>{nullableEpgMetric(item.channelCount)} channels · {nullableEpgMetric(item.programmeCount)} programmes · {nullableEpgMetric(item.mappedChannels)} mapped</small><small>Last refresh: {formatTimestamp(item.lastRefreshAt)} · {item.lastRefreshStatus ?? 'Never'}</small></div><button type="button" disabled={busy} onClick={() => onManage(item)}>Manage</button></div>) : <small>No EPG sources configured.</small>}</div>
      </> : null}
      {step === 'source' && source ? <>
        <div className="epgWizardMetricGrid"><span>Kind<strong>{source.sourceKind}</strong></span><span>Status<strong>{source.enabled ? 'Enabled' : 'Disabled'}</strong></span><span>Priority<strong>{source.priority}</strong></span><span>Channels<strong>{nullableEpgMetric(source.channelCount)}</strong></span><span>Programmes<strong>{nullableEpgMetric(source.programmeCount)}</strong></span><span>Mapped<strong>{nullableEpgMetric(source.mappedChannels)}</strong></span><span>Mapping<strong>{source.mappingPercentage == null ? 'Not recorded' : `${(source.mappingPercentage * 100).toFixed(1)}%`}</strong></span><span>Current<strong>{source.currentProgramCoverage == null ? 'Not recorded' : `${(source.currentProgramCoverage * 100).toFixed(1)}%`}</strong></span><span>Future<strong>{source.futureProgramCoverage == null ? 'Not recorded' : `${(source.futureProgramCoverage * 100).toFixed(1)}%`}</strong></span></div>
        <p className="providerNote">Last refresh: {formatTimestamp(source.lastRefreshAt)} · {source.lastRefreshStatus ?? 'Never'}</p>
        <div className="epgWizardActions epgSourceActions"><button type="button" disabled={busy} onClick={() => onEdit(source)}>Edit</button><button type="button" disabled={busy} onClick={() => onRefresh(source)}>Refresh</button><details className="epgSourceMore"><summary>More</summary><div><button type="button" disabled={busy} onClick={() => onTest(source)}>Test</button><button type="button" aria-label="Mapping Audit" disabled={busy} onClick={() => onMappingAudit(source)}>Audit</button><button type="button" disabled={busy} onClick={() => onToggle(source)}>{source.enabled ? 'Disable' : 'Enable'}</button></div></details></div>
        <details className="epgWizardDanger"><summary>Danger zone</summary><button type="button" className="dangerButton" disabled={busy} onClick={() => onDelete(source)}>Delete source</button></details>
        <button type="button" className="ghost epgWizardBack" onClick={() => onStep('overview')}>Back to Sources</button>
      </> : null}
      {step === 'coverage' ? <><CombinedCoveragePanel preview={preview ?? {}} /><button type="button" className="ghost epgWizardBack" onClick={() => onStep('overview')}>Back</button></> : null}
      {step === 'audit' ? <><EpgMappingAuditPanel result={audit ?? {}} /><button type="button" className="ghost epgWizardBack" onClick={() => onStep('source')}>Back</button></> : null}
    </section>
  </div>;
}

function nullableEpgMetric(valueToFormat: unknown, suffix = '') {
  return valueToFormat == null ? 'Not recorded' : `${valueToFormat}${suffix}`;
}

function CombinedCoveragePanel({ preview }: { preview: EpgResult }) {
  const readiness = (preview.readiness ?? {}) as Record<string, unknown>;
  const status = (valueToFormat: unknown) => valueToFormat === true ? 'READY' : valueToFormat === false ? 'NEEDS WORK' : 'NOT RECORDED';
  const reasonText = Array.isArray(readiness.reasons) ? readiness.reasons.map((reason) => String(reason).replace(/_/g, ' ')).join(', ') : 'Not recorded';
  const mapSummary = (valueToFormat: unknown) => valueToFormat && typeof valueToFormat === 'object' ? Object.entries(valueToFormat as Record<string, unknown>).slice(0, 6).map(([key, valueToShow]) => `${key}: ${valueToShow}`).join(' · ') || 'Not recorded' : 'Not recorded';
  return <div className="providerDiagnostics compact"><strong>Combined coverage preview</strong><div className="epgWizardMetricGrid"><span>Resolved<strong>{value(preview, 'resolvedChannels')}</strong></span><span>Unresolved<strong>{value(preview, 'unresolvedChannels')}</strong></span><span>Considered<strong>{value(preview, 'totalProviderChannelsConsidered')}</strong></span><span>Mapping<strong>{preview.mappingPercent == null ? 'Not recorded' : `${(Number(preview.mappingPercent) * 100).toFixed(1)}%`}</strong></span><span>US mapped<strong>{nullableEpgMetric(preview.usCombinedResolved)} / {nullableEpgMetric(preview.usRelevantRows)}</strong></span><span>Conflicts<strong>{nullableEpgMetric(preview.differentTargetConflict)}</strong></span></div><p>Resolved by source: {mapSummary(preview.resolvedBySource)}</p><p>Resolved by match: {mapSummary(preview.resolvedByMatchType)}</p><p>US programmes: current {preview.usCurrentProgrammePercent == null ? 'Not recorded' : `${Number(preview.usCurrentProgrammePercent).toFixed(1)}%`} · future {preview.usFutureProgrammePercent == null ? 'Not recorded' : `${Number(preview.usFutureProgrammePercent).toFixed(1)}%`}</p><p>Readiness: Mapping {status(readiness.mappingReady)} · Programme coverage {status(readiness.programmeCoverageReady)} · Conflict safety {status(readiness.conflictRiskAcceptable)} · Managed Guide Delivery {readiness.managedGuideDeliveryReady === true ? 'READY' : readiness.managedGuideDeliveryReady === false ? 'NOT READY' : 'NOT RECORDED'}</p><small>Reasons: {reasonText}</small></div>;
}

function SignalRow({ label, value: signal }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{signal}</strong></div>;
}

function checkLabel(check: Record<string, unknown> | undefined) {
  if (!check) return 'Not tested';
  const verdict = String(check.verdict ?? 'skip');
  return verdict === 'pass' ? 'Healthy' : verdict === 'warn' ? 'Warning' : verdict === 'fail' ? 'Failed' : 'Not tested';
}

function catalogLabel(summary: Summary | null) {
  const checks = summary?.checks ?? [];
  const catalogChecks = checks.filter((check) => ['live-catalog', 'movie-catalog', 'series-catalog'].includes(String(check.id)));
  if (!catalogChecks.length) return 'Not tested';
  if (catalogChecks.some((check) => check.verdict === 'fail')) return 'Needs attention';
  if (catalogChecks.some((check) => check.verdict === 'warn')) return 'Warning';
  return 'Healthy';
}

function probeLabel(summary: Summary | null) {
  const probes = summary?.probes;
  if (!probes) return 'Not tested';
  const total = (probes.live?.total ?? 0) + (probes.movies?.total ?? 0) + (probes.episodes?.total ?? 0);
  const passed = (probes.live?.passed ?? 0) + (probes.movies?.passed ?? 0) + (probes.episodes?.passed ?? 0);
  return total === 0 ? 'Not tested' : passed === total ? 'Healthy' : passed ? 'Partial' : 'Failed';
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

function isFreshProviderValidationLease(provider: Row) {
  const updatedAt = Date.parse(String(provider.updated_at ?? ''));
  return Number.isFinite(updatedAt) && Date.now() - updatedAt < PROVIDER_VALIDATION_LEASE_MS;
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
