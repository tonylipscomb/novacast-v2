import React, { useEffect, useMemo, useState } from 'react';
import { adminRequest } from './pairing';
import { diagnosticEventLabel, diagnosticEventStage, diagnosticEventStatus, diagnosticStatusLabel, diagnosticTone, formatDiagnosticDuration } from './diagnosticsPresentation';
import { captureRemainingLabel, deviceMatchesQuery } from './deviceDiagnosticsPresentation';
import { formatDiagnosticValue, normalizeDiagnosticLogs } from './diagnosticsNormalization';

type Row = Record<string, any>;
type DiagnosticsData = { summary?: Row; devices?: Row[]; selectedDevice?: Row; sessions?: Row[]; events?: Row[]; supportLogs?: Row[] };
const TABS = ['OVERVIEW', 'PLAYBACK', 'NETWORK', 'PROVIDER', 'SUPPORT LOG', 'TECHNICAL'];
const LOG_FILTERS = ['ALL', 'ERRORS', 'WARNINGS', 'PLAYBACK', 'NETWORK', 'PROVIDER', 'APP'];

function AdminDiagnosticsContent({ token }: { token: string; onMessage?: (message: string) => void }) {
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [hours, setHours] = useState('24');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [selectedCode, setSelectedCode] = useState('');
  const [tab, setTab] = useState('OVERVIEW');
  const [logFilter, setLogFilter] = useState('ALL');
  const [logHours, setLogHours] = useState('24');
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureMessage, setCaptureMessage] = useState('');
  const [clock, setClock] = useState(Date.now());

  const load = async (deviceCode = '') => {
    setLoading(true); setError('');
    try {
      const suffix = deviceCode ? `&deviceId=${encodeURIComponent(deviceCode)}` : '';
      setData(await adminRequest(`admin-diagnostics?hours=${hours}${suffix}`, token));
    } catch { setError('Diagnostics data could not be loaded. Check the diagnostics service and try again.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(selectedCode); }, [token, hours]);
  const devices = data?.devices ?? [];
  const selected = data?.selectedDevice ?? devices.find((device) => device.publicDeviceCode === selectedCode) ?? null;
  const filteredDevices = useMemo(() => devices.filter((device) => deviceMatchesQuery(device, query)).slice(0, 100), [devices, query]);
  const summary = data?.summary ?? {};
  const metrics = [['TOTAL TESTERS', summary.totalDevices], ['HEALTHY', summary.healthy], ['NEEDS ATTENTION', Number(summary.degraded ?? 0) + Number(summary.activePlaybackIssues ?? 0)], ['OFFLINE', summary.offline], ['PLAYBACK ISSUES', summary.activePlaybackIssues]];
  const selectDevice = (device: Row) => { const code = String(device.publicDeviceCode ?? ''); setSelectedCode(code); setQuery(code); setTab('OVERVIEW'); setCaptureMessage(''); void load(code); };

  useEffect(() => {
    if (!selected?.captureActive || !selected.captureExpiresAt) return;
    const timer = window.setTimeout(() => setClock(Date.now()), 30_000);
    return () => window.clearTimeout(timer);
  }, [selected?.captureActive, selected?.captureExpiresAt, clock]);

  const runCapture = async (action: 'start_diagnostics_capture' | 'stop_diagnostics_capture') => {
    if (!selectedCode) return;
    setCaptureBusy(true); setCaptureMessage('');
    try {
      await adminRequest('admin-device-action', token, { method: 'POST', body: JSON.stringify({ deviceId: selectedCode, action }) });
      await load(selectedCode);
    } catch { setCaptureMessage('Capture command could not be sent.'); }
    finally { setCaptureBusy(false); }
  };

  return <div className="diagnosticsPage">
    <div className="diagnosticsToolbar"><div><span className="diagnosticsEyebrow">BETA SUPPORT</span><strong>Device Diagnostics Center</strong><small>Fleet health at a glance, with one focused device workspace.</small></div><select value={hours} onChange={(event) => setHours(event.target.value)} aria-label="Diagnostics time range"><option value="1">Last hour</option><option value="24">Last 24 hours</option><option value="168">Last 7 days</option></select><button onClick={() => void load(selectedCode)} disabled={loading}>{loading ? 'Refreshing' : 'Refresh'}</button></div>
    {error ? <div className="diagnosticsError" role="alert">{error}<button onClick={() => void load(selectedCode)}>Retry</button></div> : null}
    {loading && !data ? <div className="diagnosticEmpty">Loading support diagnostics…</div> : null}
    {data ? <>
      <div className="diagnosticMetricGrid">{metrics.map(([label, value]) => <article className="diagnosticMetric" key={String(label)}><small>{label}</small><strong>{value ?? 0}</strong></article>)}</div>
      <section className="diagnosticPanel diagnosticPicker"><header><div><span className="diagnosticsEyebrow">SELECT DEVICE</span><h2>Choose a beta tester device</h2></div><span>{devices.length} devices</span></header><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search code, tester, email, or model" aria-label="Search beta devices" />{query || !selected ? <div className="diagnosticDeviceOptions" role="listbox">{filteredDevices.map((device, index) => <button key={device.publicDeviceCode ?? index} role="option" aria-selected={device.publicDeviceCode === selectedCode} onClick={() => selectDevice(device)}><span><strong>{device.publicDeviceCode ?? 'Code unavailable'}</strong><small>{device.assignedTesterName || device.friendlyName || 'Unassigned'} · {[device.manufacturer, device.model].filter(Boolean).join(' ') || 'Model not reported'}</small></span><b className={`diagnosticStatus ${diagnosticTone(device.overallStatus)}`}>{device.overallStatus ?? 'NO DATA'}</b></button>)}{!filteredDevices.length ? <p className="diagnosticEmpty">No beta device matches that search.</p> : null}</div> : null}</section>
      {!selected ? <div className="diagnosticEmpty diagnosticNoSelection">Select a beta device to view diagnostics.</div> : <SelectedWorkspace device={selected} tab={tab} setTab={setTab} logFilter={logFilter} setLogFilter={setLogFilter} logHours={logHours} setLogHours={setLogHours} captureBusy={captureBusy} captureMessage={captureMessage} onCapture={runCapture} clock={clock} />}
    </> : null}
  </div>;
}

function SelectedWorkspace({ device, tab, setTab, logFilter, setLogFilter, logHours, setLogHours, captureBusy, captureMessage, onCapture, clock }: { device: Row; tab: string; setTab: (value: string) => void; logFilter: string; setLogFilter: (value: string) => void; logHours: string; setLogHours: (value: string) => void; captureBusy: boolean; captureMessage: string; onCapture: (action: 'start_diagnostics_capture' | 'stop_diagnostics_capture') => void; clock: number }) {
  const playback = device.recentPlayback ?? {};
  const report = () => { const text = ['NovaCast Beta Support Report', `Tester: ${device.assignedTesterName ?? 'Unknown'}`, `Device: ${device.publicDeviceCode ?? 'Unknown'}`, `Model: ${[device.manufacturer, device.model].filter(Boolean).join(' ') || 'Unknown'}`, `Status: ${device.overallStatus ?? 'Unknown'}`, `Internet: ${diagnosticStatusLabel(device.internet)}`, `Provider: ${diagnosticStatusLabel(device.providerStatus)}`, `Playback: ${diagnosticStatusLabel(device.playbackStatus)}`, `Last content: ${playback.contentTitle ?? 'None recorded'}`, `Likely issue: ${device.likelyCauseExplanation ?? 'Not enough data yet'}`].join('\n'); void navigator.clipboard?.writeText(text); };
  const active = device.captureActive === true && !!device.captureExpiresAt && Date.parse(device.captureExpiresAt) > clock;
  return <section className="diagnosticPanel diagnosticWorkspace"><header className="diagnosticWorkspaceHeader"><div><span className="diagnosticsEyebrow">SELECTED DEVICE</span><h2>{device.assignedTesterName || device.friendlyName || 'Unassigned tester'}</h2><strong>{device.publicDeviceCode ?? 'Device code unavailable'}</strong><p>{[device.manufacturer, device.model].filter(Boolean).join(' ') || 'Model not reported'} · NovaCast {device.appVersion ?? 'version unavailable'} ({device.appBuild ?? 'build unavailable'})</p><p>Provider: {device.providerName ?? 'Unassigned'} · Last seen: {device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : 'Not enough data yet'}</p></div><div className="diagnosticCapture"><b className={`diagnosticStatus ${diagnosticTone(device.overallStatus)}`}>{device.overallStatus ?? 'NO DATA'}</b>{active ? <><strong>🔴 ENHANCED CAPTURE ACTIVE</strong><span>{captureRemainingLabel(device.captureExpiresAt, clock)} remaining</span><button onClick={() => onCapture('stop_diagnostics_capture')} disabled={captureBusy}>Stop capture</button></> : <><span>Temporarily collect enhanced troubleshooting signals for this device.</span><button onClick={() => onCapture('start_diagnostics_capture')} disabled={captureBusy}>Start 15-minute capture</button></>}{captureMessage ? <small>{captureMessage}</small> : null}</div></header><div className="diagnosticWorkspaceActions"><button onClick={report}>Copy support report</button></div><div className="diagnosticTabs" role="tablist">{TABS.map((value) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'selected' : ''} onClick={() => setTab(value)}>{value}</button>)}</div>{tab === 'SUPPORT LOG' ? <SupportLog device={device} filter={logFilter} setFilter={setLogFilter} hours={logHours} setHours={setLogHours} /> : <WorkspaceTab device={device} tab={tab} />}</section>;
}

function UnsafeWorkspaceTab({ device, tab }: { device: Row; tab: string }) {
  const playback = device.recentPlayback ?? {};
  const facts: [string, unknown][] = [['Content', playback.contentTitle], ['Content type', playback.contentType], ['Provider', device.providerName], ['Started', playback.startedAt ? new Date(playback.startedAt).toLocaleString() : null], ['Ended / current state', playback.endedAt ? new Date(playback.endedAt).toLocaleString() : (playback.finalResult ?? 'In progress')], ['Time to first frame', formatDiagnosticDuration(playback.timeToFirstFrameMs)], ['Playback duration', formatDiagnosticDuration(playback.playbackDurationMs)], ['Buffer count', playback.bufferCount ?? 0], ['Total buffering time', formatDiagnosticDuration(playback.totalBufferDurationMs)], ['Final result', playback.finalResult ?? (device.recentError ? 'FAILED' : 'In progress')], ['Recent error', device.recentError?.errorCode ?? 'None recorded']];
  if (tab === 'NETWORK') return <InfoGrid title="Network" items={ [['Connection', device.network?.connectionType], ['Internet', device.network?.internetReachable === true ? 'Reachable' : device.network?.internetReachable === false ? 'Unreachable' : 'Not enough data'], ['Observed latency', device.network?.latencyMs == null ? 'Not enough data' : `${device.network.latencyMs} ms`] ] as [string, unknown][] } />;
  if (tab === 'PROVIDER') return <InfoGrid title="Provider" items={ [['Provider', device.providerName], ['Reachability', diagnosticStatusLabel(device.providerStatus)], ['Last provider request', device.providerDiagnostics?.lastProviderRequestAt ? new Date(device.providerDiagnostics.lastProviderRequestAt).toLocaleString() : null], ['Last successful request', device.providerDiagnostics?.lastSuccessfulProviderRequestAt ? new Date(device.providerDiagnostics.lastSuccessfulProviderRequestAt).toLocaleString() : null], ['Last failed request', device.providerDiagnostics?.lastFailedProviderRequestAt ? new Date(device.providerDiagnostics.lastFailedProviderRequestAt).toLocaleString() : null] ] as [string, unknown][] } />;
  if (tab === 'PLAYBACK') return <InfoGrid title="Recent playback" items={facts} />;
  if (tab === 'TECHNICAL') return <div className="diagnosticEventList">{(device.events ?? []).map((event: Row, index: number) => { const metadata = event.metadata ?? {}; const title = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata.contentTitle : null; return <details className="diagnosticEvent" key={event.id ?? index}><summary><time>{event.event_at ? new Date(event.event_at).toLocaleTimeString() : '—'}</time><strong>{diagnosticEventLabel(event.event_type)}</strong><span>{diagnosticEventStage(event.event_type)}{title ? ` · ${formatDiagnosticValue(title)}` : ''}</span><b>{diagnosticEventStatus(event.event_type)}</b></summary><div className="diagnosticEventRaw"><small>Raw details</small><pre>{formatDiagnosticValue(metadata)}</pre></div></details>; })}{!(device.events ?? []).length ? <p className="diagnosticEmpty">No technical events for this device.</p> : null}</div>;
  return <><div className="diagnosticIndicators">{[['INTERNET', device.internet], ['PROVIDER', device.providerStatus], ['PLAYBACK', device.playbackStatus]].map(([label, value]) => <div key={String(label)}><span>{label}</span><strong className={`diagnosticIndicator ${diagnosticTone(value)}`}>{diagnosticStatusLabel(value)}</strong></div>)}</div><InfoGrid title="Playback facts" items={facts} /><div className="diagnosticCause"><small>LIKELY ISSUE</small><strong>{String(device.likelyCause ?? 'UNKNOWN').replaceAll('_', ' ')}</strong><p>{device.likelyCauseExplanation ?? 'Not enough data yet'}</p></div></>;
}

function InfoGrid({ title, items }: { title: string; items: Array<[string, unknown]> }) { return <div className="diagnosticInfoSection"><h3>{title}</h3><div className="diagnosticInfoGrid">{items.map(([label, value]) => <div key={label}><small>{label}</small><strong>{value == null || value === '' ? 'Not enough data yet' : formatDiagnosticValue(value)}</strong></div>)}</div></div>; }

function UnsafeSupportLog({ device, filter, setFilter, hours, setHours }: { device: Row; filter: string; setFilter: (value: string) => void; hours: string; setHours: (value: string) => void }) {
  const cutoff = Date.now() - Number(hours) * 60 * 60 * 1000;
  const supportLogs = normalizeDiagnosticLogs(device.supportLogs);
  const logs = supportLogs.filter((entry: Row) => {
    const timestamp = entry.logged_at == null ? NaN : Date.parse(entry.logged_at);
    return (!entry.logged_at || (Number.isFinite(timestamp) && timestamp >= cutoff)) &&
      (filter === 'ALL' || (filter === 'ERRORS' && entry.level === 'error') ||
        (filter === 'WARNINGS' && entry.level === 'warning') || entry.category === filter.toLowerCase());
  });
  return <div className="diagnosticSupportLog"><header><div><span className="diagnosticsEyebrow">SUPPORT LOG</span><h3>Structured troubleshooting timeline</h3></div><select value={hours} onChange={(event) => setHours(event.target.value)} aria-label="Support log time range"><option value="0.25">Last 15 minutes</option><option value="1">Last hour</option><option value="24">Last 24 hours</option></select></header><div className="diagnosticLogFilters">{LOG_FILTERS.map((value) => <button className={filter === value ? 'selected' : ''} key={value} onClick={() => setFilter(value)}>{value}</button>)}</div>{logs.map((entry: Row, index: number) => { const context = entry.context && typeof entry.context === 'object' && !Array.isArray(entry.context) ? entry.context : {}; return <details className="diagnosticLogEntry" key={entry.id ?? index}><summary><time>{entry.logged_at ? new Date(entry.logged_at).toLocaleTimeString() : '—'}</time><span><b>{String(entry.category ?? 'app').toUpperCase()}</b>{String(entry.message ?? 'Diagnostic event')}<small>{context.contentTitle == null ? '' : formatDiagnosticValue(context.contentTitle)}</small></span><strong className={`diagnosticLogLevel ${String(entry.level ?? 'info')}`}>{String(entry.level ?? 'info')}</strong></summary><div className="diagnosticEventRaw"><pre>{formatDiagnosticValue(context)}</pre></div></details>; })}{!logs.length ? <p className="diagnosticEmpty">No support log entries in this filter.</p> : null}</div>;
}

class DiagnosticsErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error('[NovaCast Diagnostics] render failed', error); }
  render() { return this.state.failed ? <div className="diagnosticEmpty" role="alert">Diagnostics could not be rendered. Refresh the device data to try again.</div> : this.props.children; }
}

function WorkspaceTab(props: { device: Row; tab: string }) {
  return <DiagnosticsErrorBoundary key={`${props.device.publicDeviceCode ?? 'device'}:${props.tab}`}><UnsafeWorkspaceTab {...props} /></DiagnosticsErrorBoundary>;
}

function SupportLog(props: { device: Row; filter: string; setFilter: (value: string) => void; hours: string; setHours: (value: string) => void }) {
  return <DiagnosticsErrorBoundary key={props.device.publicDeviceCode ?? 'device'}><UnsafeSupportLog {...props} /></DiagnosticsErrorBoundary>;
}

export function AdminDiagnostics(props: { token: string; onMessage?: (message: string) => void }) {
  return <AdminDiagnosticsContent {...props} />;
}
