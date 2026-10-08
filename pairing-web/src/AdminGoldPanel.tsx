import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { adminRequest } from './pairing';
import { canSubmitGoldImport, canSubmitPaidGoldCreation, paidGoldCreditWarning, resolveGoldImportRequest, resolveGoldPackageState, resolvePaidGoldCreationRequest, type GoldAccountType } from './adminGoldPanelState';
import { classifyGoldExpiration, EXPIRATION_BUCKETS, EXPIRATION_BUCKET_LABELS, filterGoldLines, normalizeGoldLine, sortGoldLines, type ExpirationBucket, type GoldLine } from './goldOperations';

type ApiRecord = Record<string, unknown>;
type Props = { token: string; devices: ApiRecord[]; providers: ApiRecord[]; onAssignProvider: (deviceId: string, providerId: string) => void; onMessage: (message: string) => void; openCreate?: boolean; onOpenCreateHandled?: () => void };
type PanelTab = 'overview' | 'lines' | 'add' | 'demo' | 'packages' | 'account';
type GoldPackage = { id: string; name: string };
type CreatedCredentials = { username: string; password: string; baseUrl: string; expiration: string; packageName: string };
type GoldForm = { accountType: GoldAccountType; m3uUrl: string; sub: string; packageId: string; country: string; notes: string; displayName: string; runDiagnostics: boolean; activateIfHealthy: boolean };

const SUBSCRIPTIONS = [['1', '1 Month'], ['3', '3 Months'], ['6', '6 Months'], ['12', '12 Months']];
const EMPTY_FORM: GoldForm = { accountType: 'import', m3uUrl: '', sub: '1', packageId: '', country: 'US', notes: '', displayName: '', runDiagnostics: true, activateIfHealthy: false };

function asRecord(value: unknown): ApiRecord { return value && typeof value === 'object' && !Array.isArray(value) ? value as ApiRecord : {}; }
function asRecords(value: unknown): ApiRecord[] { return Array.isArray(value) ? value.map(asRecord) : []; }
function errorLabel(error: unknown) {
  const message = error instanceof Error ? error.message : 'request failed';
  const labels: Record<string, string> = { admin_unauthorized: 'session expired', gold_query_failed: 'Gold account unavailable', gold_packages_invalid_response: 'package list unavailable', gold_request_failed: 'Gold API unavailable', gold_sync_failed: 'Gold account sync failed', provider_not_found: 'provider unavailable', gold_m3u_invalid: 'provider validation failed' };
  return labels[message] ?? message.replaceAll('_', ' ');
}

export function AdminGoldPanel({ token, providers, onAssignProvider, onMessage, openCreate, onOpenCreateHandled }: Props) {
  const [accounts, setAccounts] = useState<ApiRecord[]>([]);
  const [reseller, setReseller] = useState<ApiRecord | null>(null);
  const [packages, setPackages] = useState<GoldPackage[]>([]);
  const [activity, setActivity] = useState<ApiRecord[]>([]);
  const [activityUnavailable, setActivityUnavailable] = useState(false);
  const [packageEmptyReason, setPackageEmptyReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<PanelTab>('overview');
  const [modal, setModal] = useState(false);
  const [selected, setSelected] = useState<GoldLine | null>(null);
  const [renewTarget, setRenewTarget] = useState<GoldLine | null>(null);
  const [recovery, setRecovery] = useState<ApiRecord | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<CreatedCredentials | null>(null);
  const [expirationFilter, setExpirationFilter] = useState<ExpirationBucket | null>(null);
  const [query, setQuery] = useState('');
  const [lineStatus, setLineStatus] = useState<'all' | 'active' | 'expired'>('all');
  const [lineSort, setLineSort] = useState<'expiration' | 'created'>('expiration');
  const [linePackage, setLinePackage] = useState('');
  const [lineExpiration, setLineExpiration] = useState<ExpirationBucket | null>(null);
  const [linePage, setLinePage] = useState(1);
  const [form, setForm] = useState<GoldForm>(EMPTY_FORM);

  const lines = useMemo(() => accounts.map(normalizeGoldLine).filter((line) => line.id), [accounts]);
  const bucketCounts = useMemo(() => Object.fromEntries(EXPIRATION_BUCKETS.map((bucket) => [bucket, lines.filter((line) => classifyGoldExpiration(line.expiration) === bucket).length])), [lines]);
  const filteredLines = useMemo(() => sortGoldLines(filterGoldLines(lines, query, lineStatus, linePackage, lineExpiration), lineSort), [lines, query, lineStatus, linePackage, lineExpiration, lineSort]);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filteredLines.length / pageSize));
  const visiblePage = Math.min(linePage, totalPages);
  const pageLines = filteredLines.slice((visiblePage - 1) * pageSize, visiblePage * pageSize);
  const expiringSoon = (bucketCounts.today ?? 0) + (bucketCounts.tomorrow ?? 0) + (bucketCounts.next7 ?? 0);
  const activeLines = lines.filter((line) => line.enabled !== false && classifyGoldExpiration(line.expiration) !== 'expired').length;
  const canSubmit = form.accountType === 'import' ? canSubmitGoldImport(form.m3uUrl) : canSubmitPaidGoldCreation(packages, form.packageId, form.sub);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [listResult, resellerResult, packageResult, activityResult] = await Promise.all([
        adminRequest('admin-gold-panel', token),
        adminRequest('admin-gold-panel', token, { method: 'POST', body: JSON.stringify({ action: 'reseller' }) }),
        adminRequest('admin-gold-panel', token, { method: 'POST', body: JSON.stringify({ action: 'packages' }) }),
        adminRequest('admin-gold-panel', token, { method: 'POST', body: JSON.stringify({ action: 'activity' }) }).catch(() => ({ activity: [], unavailable: true })),
      ]);
      const packageState = resolveGoldPackageState(asRecord(packageResult));
      setAccounts(asRecords(asRecord(listResult).accounts));
      setReseller(asRecord(asRecord(resellerResult).reseller));
      setPackages(packageState.packages as GoldPackage[]);
      setPackageEmptyReason(packageState.emptyReason);
      setActivity(asRecords(asRecord(activityResult).activity));
      setActivityUnavailable(asRecord(activityResult).unavailable === true);
    } catch (error) {
      onMessage(`Gold Panel could not refresh (${errorLabel(error)}).`);
    } finally { setLoading(false); }
  }, [token, onMessage]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);
  useEffect(() => { if (openCreate) queueMicrotask(() => { setModal(true); onOpenCreateHandled?.(); }); }, [openCreate, onOpenCreateHandled]);

  const action = async (body: ApiRecord, message: string) => {
    if (busy) return;
    setBusy(true);
    try { await adminRequest('admin-gold-panel', token, { method: 'POST', body: JSON.stringify(body) }); onMessage(message); await load(); }
    catch (error) { onMessage(`Gold operation failed (${errorLabel(error)}).`); }
    finally { setBusy(false); }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !canSubmit) return;
    const warning = paidGoldCreditWarning(form.accountType);
    if (warning && !window.confirm(warning)) return;
    setBusy(true);
    try {
      const body = form.accountType === 'import' ? resolveGoldImportRequest(form) : resolvePaidGoldCreationRequest(form);
      const result = asRecord(await adminRequest('admin-gold-panel', token, { method: 'POST', body: JSON.stringify(body) }));
      setModal(false);
      const createdAccount = asRecord(result.account);
      if (typeof createdAccount.id === 'string') {
        const account = createdAccount;
        try {
          const credentials = asRecord(await adminRequest('admin-gold-panel', token, { method: 'POST', body: JSON.stringify({ action: 'account_credentials', accountId: account.id }) }));
          setCreatedCredentials({ username: String(credentials.username ?? ''), password: String(credentials.password ?? ''), baseUrl: String(credentials.baseUrl ?? ''), expiration: String(account.gold_expiration ?? 'Unavailable'), packageName: String(account.gold_package_name ?? form.packageId ?? 'Unavailable') });
        } catch { onMessage('Gold account created. Credentials are available through the row action menu.'); }
      }
      onMessage(result.summary ? 'Gold account imported and diagnostics completed.' : 'Gold account created as a NovaCast provider draft.');
      await load();
    } catch (error) {
      const payload = asRecord((error as Error & { payload?: unknown }).payload);
      if (payload.recoveryRequired && payload.recoveryReference) setRecovery(payload);
      else onMessage(`Gold account could not be created (${errorLabel(error)}).`);
    } finally { setBusy(false); }
  };

  const copyCredentials = async (line: GoldLine) => {
    if (!window.confirm(`Reveal and copy credentials for ${line.username}?`)) return;
    try {
      const result = asRecord(await adminRequest('admin-gold-panel', token, { method: 'POST', body: JSON.stringify({ action: 'account_credentials', accountId: line.id }) }));
      await navigator.clipboard?.writeText(`Server: ${String(result.baseUrl ?? '')}\nUsername: ${String(result.username ?? '')}\nPassword: ${String(result.password ?? '')}`);
      onMessage('Credentials copied.');
    } catch { onMessage('Credentials could not be copied.'); }
  };

  const copyM3u = async (line: GoldLine) => {
    if (!window.confirm(`Reveal and copy the M3U link for ${line.username}?`)) return;
    try {
      const result = asRecord(await adminRequest('admin-gold-panel', token, { method: 'POST', body: JSON.stringify({ action: 'account_credentials', accountId: line.id }) }));
      const baseUrl = String(result.baseUrl ?? '').replace(/\/+$/, '');
      const params = new URLSearchParams({ username: String(result.username ?? ''), password: String(result.password ?? ''), type: 'm3u_plus', output: 'ts' });
      await navigator.clipboard?.writeText(`${baseUrl}/get.php?${params.toString()}`);
      onMessage('M3U link copied.');
    } catch { onMessage('M3U link could not be copied.'); }
  };

  const assign = (line: GoldLine) => {
    const providerId = line.providerId;
    const deviceId = window.prompt('Enter the NovaCast device UUID to assign this Gold provider to:');
    if (deviceId?.trim() && providerId) onAssignProvider(deviceId.trim(), providerId);
  };

  const openLine = (line: GoldLine) => { setSelected(line); setTab('lines'); };
  const requestRenew = (line: GoldLine) => { if (!busy) setRenewTarget(line); };
  const visibleByExpiration = expirationFilter ? lines.filter((line) => classifyGoldExpiration(line.expiration) === expirationFilter) : lines;

  return <div className="providersPage goldPanel">
    <section className="inviteHero goldHero"><div className="inviteHeroCopy"><div className="inviteIcon">G</div><div><span className="eyebrow">NOVACAST GOLD PANEL</span><h2>Gold Operations</h2><p>Manage Gold-linked accounts and their NovaCast provider state.</p></div></div><div className="inviteHeroMetrics"><Metric label="CREDITS" value={String(reseller?.credits ?? 'Unavailable')} detail={reseller?.enabled === false ? 'Connection disabled' : 'Gold reseller'} tone={reseller?.enabled === false ? 'red' : 'blue'} /><Metric label="ACTIVE LINES" value={activeLines} detail={`${lines.length} total`} /><Metric label="EXPIRING SOON" value={expiringSoon} detail="Next 7 days" tone={expiringSoon ? 'amber' : 'blue'} /><Metric label="PACKAGES" value={packages.length || 'Unavailable'} detail={packageEmptyReason ? 'No custom bouquets' : 'Available'} /></div></section>
    <nav className="goldPanelTabs" aria-label="Gold operations"><Tab active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</Tab><Tab active={tab === 'lines'} onClick={() => setTab('lines')}>Manage Lines <b>{lines.length}</b></Tab><Tab active={tab === 'add'} onClick={() => { setForm({ ...EMPTY_FORM, accountType: 'paid' }); setTab('add'); }}>Add New Line</Tab><Tab active={tab === 'demo'} onClick={() => { setForm({ ...EMPTY_FORM, accountType: 'paid', sub: '1' }); setTab('demo'); }}>Create Demo</Tab><Tab active={tab === 'packages'} onClick={() => setTab('packages')}>Packages</Tab><Tab active={tab === 'account'} onClick={() => setTab('account')}>Account</Tab><button className="ghost" onClick={() => void load()}>Refresh</button><button className="cloudPrimary" onClick={() => { setForm(EMPTY_FORM); setModal(true); }}>Quick Add</button></nav>
    {loading ? <div className="cloudLoading">Loading Gold operations</div> : tab === 'overview' ? <Overview lines={lines} activity={activity} activityUnavailable={activityUnavailable} bucketCounts={bucketCounts} expirationFilter={expirationFilter} onBucket={(bucket) => { setExpirationFilter(bucket); setTab('lines'); }} onView={openLine} onRenew={requestRenew} /> : null}
    {!loading && tab === 'lines' ? <LinesTable lines={pageLines} total={filteredLines.length} page={visiblePage} totalPages={totalPages} query={query} status={lineStatus} packageName={linePackage} expiration={lineExpiration} packages={packages} onQuery={setQuery} onStatus={setLineStatus} onPackage={setLinePackage} onExpiration={setLineExpiration} onSort={setLineSort} sort={lineSort} onPage={setLinePage} onView={openLine} onSync={(line) => void action({ action: 'sync_account', accountId: line.id }, 'Gold account synced.')} onDiagnostics={(line) => void action({ action: 'run_diagnostics', accountId: line.id }, 'Gold diagnostics completed.')} onRenew={requestRenew} onToggle={(line) => void action({ action: 'set_account_status', accountId: line.id, enabled: line.enabled === false }, line.enabled === false ? 'Gold account enabled.' : 'Gold account disabled.')} onAssign={assign} onCredentials={(line) => void copyCredentials(line)} onM3u={(line) => void copyM3u(line)} busy={busy} /> : null}
    {!loading && (tab === 'add' || tab === 'demo') ? <CreateWorkspace mode={tab === 'demo' ? 'demo' : 'paid'} form={form} packages={packages} packageEmptyReason={packageEmptyReason} busy={busy} onChange={setForm} onClose={() => setTab('overview')} onSubmit={create} /> : null}
    {!loading && tab === 'packages' ? <PackagesTab packages={packages} emptyReason={packageEmptyReason} /> : null}
    {!loading && tab === 'account' ? <AccountTab reseller={reseller} /> : null}
    {expirationFilter && tab !== 'lines' ? <p className="providerNote">{visibleByExpiration.length} accounts match {EXPIRATION_BUCKET_LABELS[expirationFilter]}.</p> : null}
    {modal ? <CreateWorkspace mode="paid" form={form} packages={packages} packageEmptyReason={packageEmptyReason} busy={busy} onChange={setForm} onClose={() => setModal(false)} onSubmit={create} modal /> : null}
    {recovery ? <Modal title={recovery.goldImported ? 'Gold account imported' : 'Gold account created'} onClose={() => setRecovery(null)}><p>NovaCast provider creation failed, but encrypted credentials were retained temporarily on the server.</p><div className="modalActions"><button className="ghost" onClick={() => setRecovery(null)}>Dismiss</button><button className="submit" disabled={busy} onClick={() => void action({ action: 'retry_recovery', recoveryReference: recovery.recoveryReference }, 'NovaCast provider setup completed.')}>Retry NovaCast Setup</button></div></Modal> : null}
    {createdCredentials ? <CredentialResult credentials={createdCredentials} onClose={() => setCreatedCredentials(null)} /> : null}
    {renewTarget ? <RenewModal line={renewTarget} busy={busy} onClose={() => setRenewTarget(null)} onSubmit={(sub) => { if (!window.confirm(`Renew ${renewTarget.username} for ${sub} month${sub === '1' ? '' : 's'} using Gold credits?`)) return; setRenewTarget(null); void action({ action: 'renew_account', accountId: renewTarget.id, sub }, `Gold account renewal requested for ${sub} month${sub === '1' ? '' : 's'}.`); }} /> : null}
    {selected ? <LineDetails line={selected} onClose={() => setSelected(null)} onSync={() => void action({ action: 'sync_account', accountId: selected.id }, 'Gold account synced.')} /> : null}
  </div>;
}

function Overview({ lines, activity, activityUnavailable, bucketCounts, expirationFilter, onBucket, onView, onRenew }: { lines: GoldLine[]; activity: ApiRecord[]; activityUnavailable: boolean; bucketCounts: Record<string, number>; expirationFilter: ExpirationBucket | null; onBucket: (bucket: ExpirationBucket | null) => void; onView: (line: GoldLine) => void; onRenew: (line: GoldLine) => void }) {
  const expiring = lines.filter((line) => ['today', 'tomorrow', 'next7'].includes(classifyGoldExpiration(line.expiration))).slice(0, 6);
  return <><section className="goldExpirationCenter"><header><div><span className="eyebrow">EXPIRATION CENTER</span><small>Use the real Gold account data to find renewals.</small></div><button className={expirationFilter === null ? 'selected' : ''} onClick={() => onBucket(null)}>All accounts <b>{lines.length}</b></button></header><div className="goldExpirationBuckets">{EXPIRATION_BUCKETS.map((bucket) => <button key={bucket} className={`goldExpirationBucket bucket-${bucket} ${expirationFilter === bucket ? 'selected' : ''}`} onClick={() => onBucket(bucket)}><span>{EXPIRATION_BUCKET_LABELS[bucket]}</span><strong>{bucketCounts[bucket] ?? 0}</strong></button>)}</div></section><section className="goldOpsGrid"><section className="goldTableCard"><header><div><span className="eyebrow">EXPIRING SOON</span><h3>Renewals needing attention</h3></div></header>{expiring.length ? <div className="goldExpiringList">{expiring.map((line) => <article key={line.id}><div><strong>{line.displayName}</strong><small>{line.username} · {line.expiration ?? 'Unknown'}</small></div><button onClick={() => onRenew(line)}>Renew</button><button className="ghost" onClick={() => onView(line)}>View</button></article>)}</div> : <p className="goldActivityEmpty">No accounts expiring in the next 7 days.</p>}</section><ActivityFeed activity={activity} unavailable={activityUnavailable} /></section></>;
}

function LinesTable({ lines, total, page, totalPages, query, status, packageName, expiration, packages, sort, onQuery, onStatus, onPackage, onExpiration, onSort, onPage, onView, onSync, onDiagnostics, onRenew, onToggle, onAssign, onCredentials, onM3u, busy }: { lines: GoldLine[]; total: number; page: number; totalPages: number; query: string; status: 'all' | 'active' | 'expired'; packageName: string; expiration: ExpirationBucket | null; packages: GoldPackage[]; sort: 'expiration' | 'created'; onQuery: (value: string) => void; onStatus: (value: 'all' | 'active' | 'expired') => void; onPackage: (value: string) => void; onExpiration: (value: ExpirationBucket | null) => void; onSort: (value: 'expiration' | 'created') => void; onPage: (value: number) => void; onView: (line: GoldLine) => void; onSync: (line: GoldLine) => void; onDiagnostics: (line: GoldLine) => void; onRenew: (line: GoldLine) => void; onToggle: (line: GoldLine) => void; onAssign: (line: GoldLine) => void; onCredentials: (line: GoldLine) => void; onM3u: (line: GoldLine) => void; busy: boolean }) {
  return <section className="goldTableCard"><header className="goldTableHeader"><div><span className="eyebrow">MANAGE LINES</span><h3>Gold accounts</h3></div><small>{total} matching accounts · credentials hidden until explicitly revealed</small></header><div className="goldLineFilters"><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search username, package, country" aria-label="Search Gold lines" /><select value={status} onChange={(event) => onStatus(event.target.value as typeof status)}><option value="all">All status</option><option value="active">Active</option><option value="expired">Expired</option></select><select value={packageName} onChange={(event) => onPackage(event.target.value)} aria-label="Filter by package"><option value="">All packages</option>{packages.map((item) => <option key={item.id} value={item.name}>{item.name}</option>)}</select><select value={expiration ?? ''} onChange={(event) => onExpiration((event.target.value || null) as ExpirationBucket | null)} aria-label="Filter by expiration"><option value="">All expiration</option>{EXPIRATION_BUCKETS.map((bucket) => <option key={bucket} value={bucket}>{EXPIRATION_BUCKET_LABELS[bucket]}</option>)}</select><select value={sort} onChange={(event) => onSort(event.target.value as typeof sort)}><option value="expiration">Sort expiry</option><option value="created">Sort created</option></select></div>{lines.length ? <div className="goldLineTableWrap"><table className="goldLineTable"><thead><tr><th>Username</th><th>Server</th><th>Expire</th><th>Package</th><th>Country</th><th>Enabled / health</th><th>Assigned device</th><th>Created</th><th>Actions</th></tr></thead><tbody>{lines.map((line) => <tr key={line.id}><td><strong>{line.displayName}</strong><small>{line.username}</small></td><td><span className="goldServerValue">{line.upstreamUrl || 'Unavailable'}</span></td><td><StatusChip line={line} /></td><td>{line.packageName}</td><td>{line.country}</td><td><span className={`goldEnabled ${line.enabled === false ? 'off' : 'on'}`}>{line.enabled === false ? 'Disabled' : 'Enabled'}</span><small>{line.healthStatus}</small></td><td>{line.assignedDevice}</td><td>{line.createdAt ? new Date(line.createdAt).toLocaleDateString() : 'Unknown'}</td><td><details className="goldActionMenu"><summary aria-label={`Actions for ${line.username}`}>Actions</summary><div><button onClick={() => onView(line)}>View details</button><button onClick={() => onSync(line)} disabled={busy}>Sync</button><button onClick={() => onDiagnostics(line)} disabled={busy}>Diagnostics</button><button onClick={() => onRenew(line)} disabled={busy}>Renew</button><button onClick={() => onToggle(line)} disabled={busy}>{line.enabled === false ? 'Enable' : 'Disable'}</button><button onClick={() => onAssign(line)} disabled={busy}>Assign / Reassign</button><button onClick={() => onCredentials(line)} disabled={busy}>Copy credentials</button><button onClick={() => onM3u(line)} disabled={busy}>Copy M3U</button></div></details></td></tr>)}</tbody></table></div> : <div className="goldEmptyState"><strong>No Gold lines match this filter.</strong><small>Refresh the panel or create/import a supported Gold account.</small></div>}<footer className="goldPagination"><span>Page {page} of {totalPages} · {total} visible</span><button className="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><button className="ghost" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button></footer></section>;
}

function PackagesTab({ packages, emptyReason }: { packages: GoldPackage[]; emptyReason: string }) { return <section className="goldTableCard"><header><div><span className="eyebrow">PACKAGES / BOUQUETS</span><h3>Available Gold packages</h3></div></header>{packages.length ? <div className="goldPackageGrid">{packages.map((item) => <article key={item.id}><strong>{item.name}</strong><small>Package ID {item.id}</small><span>Selectable for supported account creation.</span></article>)}</div> : <div className="goldEmptyState"><strong>{emptyReason === 'no_custom_bouquets' ? 'No custom bouquets configured' : 'Packages unavailable'}</strong><small>Package editing is not exposed by the current Gold API.</small></div>}</section>; }
function AccountTab({ reseller }: { reseller: ApiRecord | null }) { return <section className="goldTableCard"><header><div><span className="eyebrow">ACCOUNT / CREDIT STATUS</span><h3>Gold reseller account</h3></div></header><dl className="goldAccountDetails"><div><span>Account</span><strong>{String(reseller?.username ?? 'Unavailable')}</strong></div><div><span>Credits</span><strong>{String(reseller?.credits ?? 'Unavailable')}</strong></div><div><span>Status</span><strong>{reseller?.enabled === false ? 'Disabled' : reseller ? 'Connected' : 'Unavailable'}</strong></div></dl><p className="providerNote">Gold credentials and upstream secrets remain server-side. This console exposes only the sanitized reseller fields returned by the API.</p></section>; }
function StatusChip({ line }: { line: GoldLine }) { const bucket = classifyGoldExpiration(line.expiration); const tone = line.enabled === false ? 'disabled' : bucket === 'expired' ? 'expired' : 'active'; return <span className={`goldStatusChip ${tone}`}>{line.enabled === false ? 'Disabled' : bucket === 'expired' ? 'Expired' : 'Active'} · {line.expiration ?? 'Unknown'}</span>; }
function RenewModal({ line, busy, onClose, onSubmit }: { line: GoldLine; busy: boolean; onClose: () => void; onSubmit: (sub: string) => void }) { const [sub, setSub] = useState('1'); return <Modal title={`Renew ${line.displayName}`} onClose={onClose}><p>Confirm a real Gold renewal for <strong>{line.username}</strong>. Current expiration: <strong>{line.expiration ?? 'Unknown'}</strong>.</p><label>Duration<select value={sub} onChange={(event) => setSub(event.target.value)}>{SUBSCRIPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><p className="providerNote">The Gold API reports the final credit cost and expiration after confirmation.</p><div className="modalActions"><button className="ghost" onClick={onClose}>Cancel</button><button className="submit" disabled={busy} onClick={() => onSubmit(sub)}>{busy ? 'Renewing…' : 'Confirm renewal'}</button></div></Modal>; }
function LineDetails({ line, onClose, onSync }: { line: GoldLine; onClose: () => void; onSync: () => void }) { return <Modal title={line.displayName} onClose={onClose}><div className="goldDetailSection"><span className="eyebrow">ACCOUNT</span><dl className="goldDetailList"><div><span>Username</span><strong>{line.username}</strong></div><div><span>Status</span><strong><StatusChip line={line} /></strong></div><div><span>Package</span><strong>{line.packageName}</strong></div><div><span>Country</span><strong>{line.country}</strong></div></dl></div><div className="goldDetailSection"><span className="eyebrow">CONNECTION</span><dl className="goldDetailList"><div><span>Server</span><strong>{line.upstreamUrl || 'Unavailable'}</strong></div><div><span>Route</span><strong>{line.routeMode}{line.routeDomain ? ` · ${line.routeDomain}` : ''}</strong></div><div><span>Provider health</span><strong>{line.healthStatus}</strong></div><div><span>Last sync</span><strong>{line.lastSyncedAt ? new Date(line.lastSyncedAt).toLocaleString() : 'Not synced'}</strong></div></dl>{line.lastSyncError ? <p className="goldInlineError">Last sync: {line.lastSyncError}</p> : null}</div><div className="goldDetailSection"><span className="eyebrow">NOVACAST</span><dl className="goldDetailList"><div><span>Managed provider</span><strong>{line.providerId || 'Unavailable'}</strong></div><div><span>Assigned device</span><strong>{line.assignedDevice}</strong></div></dl></div><p className="providerNote">Editing username, password, package, ISP lock, VPN, reseller, refunds, and uploads is not exposed by the current Gold API.</p><div className="modalActions"><button className="ghost" onClick={onClose}>Close</button><button onClick={onSync}>Sync account</button></div></Modal>; }
function ActivityFeed({ activity, unavailable }: { activity: ApiRecord[]; unavailable: boolean }) { return <section className="goldActivity"><header><div><span className="eyebrow">RECENT GOLD ACTIVITY</span><small>Formal admin events only.</small></div></header>{unavailable ? <p className="goldActivityEmpty">Gold activity history is not available yet.</p> : activity.length ? <div className="goldActivityList">{activity.slice(0, 10).map((event, index) => <article key={String(event.id ?? index)}><i /><div><strong>{String(event.action ?? 'Gold activity').replaceAll('_', ' ').toUpperCase()}</strong><small>{String(event.createdAt ?? event.created_at ?? 'Timestamp unavailable')}</small></div><b className={`activityStatus ${event.status === 'success' ? 'success' : 'failure'}`}>{String(event.status ?? 'success').toUpperCase()}</b></article>)}</div> : <p className="goldActivityEmpty">No Gold activity recorded yet.</p>}</section>; }
function CredentialResult({ credentials, onClose }: { credentials: CreatedCredentials; onClose: () => void }) { const copy = () => void navigator.clipboard?.writeText(`Server: ${credentials.baseUrl}\nUsername: ${credentials.username}\nPassword: ${credentials.password}`); return <Modal title="Gold account ready" onClose={onClose}><p>Save these credentials securely. They are shown only because the account was just created/imported.</p><dl className="goldCredentialResult"><div><span>Server</span><strong>{credentials.baseUrl || 'Unavailable'}</strong></div><div><span>Username</span><strong>{credentials.username}</strong></div><div><span>Password</span><strong>{credentials.password}</strong></div><div><span>Expiration</span><strong>{credentials.expiration}</strong></div><div><span>Package</span><strong>{credentials.packageName}</strong></div></dl><div className="modalActions"><button className="ghost" onClick={onClose}>Close</button><button className="submit" onClick={copy}>Copy Xtream credentials</button></div></Modal>; }
function CreateWorkspace({ mode, modal = false, form, packages, packageEmptyReason, busy, onChange, onClose, onSubmit }: { mode: 'paid' | 'demo'; modal?: boolean; form: GoldForm; packages: GoldPackage[]; packageEmptyReason: string; busy: boolean; onChange: (value: GoldForm) => void; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
  const title = mode === 'demo' ? 'Create Demo' : 'Add New Line';
  const content = <><div className="goldWorkspaceIntro"><span className="eyebrow">{mode === 'demo' ? 'SUPPORTED DEMO MODE' : 'GOLD ACCOUNT CREATION'}</span><h3>{mode === 'demo' ? 'Create a short Gold demo line' : 'Create or import a Gold account'}</h3><p>{mode === 'demo' ? 'The current Gold API uses the documented paid-account creation path with the selected one-month duration. No separate demo endpoint is invented.' : 'Choose a supported account path. Gold credentials remain server-side except for explicit copy actions.'}</p></div><form onSubmit={onSubmit} className="goldCreateForm">{mode === 'demo' ? <input type="hidden" value="paid" /> : <label>Account type<select value={form.accountType} onChange={(event) => onChange({ ...form, accountType: event.target.value as GoldAccountType, m3uUrl: '', packageId: '' })}><option value="import">Import existing M3U</option><option value="paid">Paid Gold line</option></select></label>}{form.accountType === 'import' && mode !== 'demo' ? <label>M3U URL<input required value={form.m3uUrl} onChange={(event) => onChange({ ...form, m3uUrl: event.target.value })} placeholder="https://server/get.php?..." /></label> : <><label>Subscription<select value={mode === 'demo' ? '1' : form.sub} disabled={mode === 'demo'} onChange={(event) => onChange({ ...form, sub: event.target.value })}>{SUBSCRIPTIONS.map(([id, label]) => <option key={id} value={id}>{mode === 'demo' && id === '1' ? '1 Month demo' : label}</option>)}</select></label><label>Package<select required disabled={!packages.length} value={form.packageId} onChange={(event) => onChange({ ...form, packageId: event.target.value })}><option value="">{packageEmptyReason ? 'No custom bouquets' : 'Select package'}</option>{packages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></>}<label>Country / VPN<input value={form.country} onChange={(event) => onChange({ ...form, country: event.target.value })} placeholder="US" /></label><label>Display name<input value={form.displayName} onChange={(event) => onChange({ ...form, displayName: event.target.value })} /></label><label>Notes<textarea value={form.notes} onChange={(event) => onChange({ ...form, notes: event.target.value })} /></label><aside className="goldCreateSummary"><span className="eyebrow">SUMMARY</span><strong>{mode === 'demo' ? '1 month demo' : `${form.sub} month${form.sub === '1' ? '' : 's'}`}</strong><small>Package: {packages.find((item) => item.id === form.packageId)?.name ?? 'Not selected'} · Country: {form.country || 'US'}</small><small>Credits are confirmed by Gold after submission; no estimate is fabricated here.</small></aside><label className="goldCheckbox"><input type="checkbox" checked={form.runDiagnostics} onChange={(event) => onChange({ ...form, runDiagnostics: event.target.checked })} /> Run diagnostics after creation</label><label className="goldCheckbox"><input type="checkbox" checked={form.activateIfHealthy} onChange={(event) => onChange({ ...form, activateIfHealthy: event.target.checked })} /> Activate only if health passes</label><div className="modalActions"><button type="button" className="ghost" onClick={onClose}>Cancel</button><button className="submit" disabled={busy || (form.accountType === 'paid' && !packages.length)}>{busy ? 'Working…' : mode === 'demo' ? 'Create demo' : 'Review and create'}</button></div></form></>;
  return modal ? <Modal title={title} onClose={onClose}>{content}</Modal> : <section className="goldTableCard goldCreateWorkspace"><header><div><span className="eyebrow">GOLD WORKSPACE</span><h2>{title}</h2></div><button className="ghost" onClick={onClose}>Back to overview</button></header>{content}</section>;
}
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) { return <div className="modalBackdrop" role="presentation"><section className="inviteModal providerModal" role="dialog" aria-modal="true"><button className="modalClose" aria-label="Close" onClick={onClose}>×</button><span className="eyebrow">NOVACAST CLOUD ADMIN</span><h2>{title}</h2>{children}</section></div>; }
function Tab({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) { return <button className={`goldPanelTab ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>{children}</button>; }
function Metric({ label, value, detail, tone = 'blue' }: { label: string; value: ReactNode; detail: string; tone?: string }) { return <div className={`inviteMetric tone-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small><i /></div>; }
