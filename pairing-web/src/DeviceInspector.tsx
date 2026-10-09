import { useMemo } from 'react';

import { AdminDiagnostics } from './AdminDiagnostics';
import { buildDeviceActivity, deviceLifecycleStatus, hasLegacyActivationHistory, readPlaybackSummary, sanitizeProviderSummary, type DeviceInspectorRow } from './deviceInspectorModel';

type InspectorTab = 'overview' | 'provider' | 'diagnostics' | 'playback' | 'activity';

export function DeviceInspector({
  token,
  device,
  provider,
  initialTab = 'overview',
  onBack,
  onTabChange,
}: {
  token: string;
  device: DeviceInspectorRow;
  provider: DeviceInspectorRow | null;
  initialTab?: InspectorTab;
  onBack: () => void;
  onTabChange: (tab: InspectorTab) => void;
}) {
  const tab = initialTab;
  const providerSummary = useMemo(() => sanitizeProviderSummary(device, provider), [device, provider]);
  const playback = useMemo(() => readPlaybackSummary(device), [device]);
  const activity = useMemo(() => buildDeviceActivity(device), [device]);
  const setInspectorTab = (next: InspectorTab) => { onTabChange(next); };
  const name = String(device.friendly_name ?? device.assigned_tester_name ?? device.public_device_code ?? 'NovaCast device');
  const online = String(device.status ?? '').toLowerCase() === 'online';

  return (
    <section className="deviceInspector">
      <button className="inspectorBack" onClick={onBack}>← Back to devices</button>
      <header className="inspectorHeader">
        <div>
          <span className="inspectorEyebrow">DEVICE INSPECTOR</span>
          <h2>{name}</h2>
          <strong>{String(device.public_device_code ?? 'Device code unavailable')}</strong>
          <p>{[device.manufacturer, device.model].filter(Boolean).join(' ') || 'Model not reported'}</p>
        </div>
        <div className="inspectorStatusStack">
          <b className={`inspectorStatus ${online ? 'healthy' : 'offline'}`}>{online ? 'ONLINE' : 'STALE / OFFLINE'}</b>
          <span>{String(device.app_version ?? 'Version unavailable')} · {device.app_build ? `Build ${String(device.app_build)}` : 'Build unavailable'}</span>
        </div>
      </header>
      <nav className="inspectorTabs" role="tablist" aria-label="Device inspector">
        {(['overview', 'provider', 'diagnostics', 'playback', 'activity'] as InspectorTab[]).map((value) => (
          <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'selected' : ''} onClick={() => setInspectorTab(value)}>
            {value[0].toUpperCase() + value.slice(1)}
          </button>
        ))}
      </nav>
      {tab === 'overview' ? <InspectorOverview device={device} provider={providerSummary} /> : null}
      {tab === 'provider' ? <InspectorProvider summary={providerSummary} /> : null}
      {tab === 'diagnostics' ? <AdminDiagnostics token={token} initialDeviceCode={String(device.public_device_code ?? '')} embedded /> : null}
      {tab === 'playback' ? <InspectorPlayback playback={playback} /> : null}
      {tab === 'activity' ? <InspectorActivity activity={activity} /> : null}
    </section>
  );
}

function InspectorOverview({ device, provider }: { device: DeviceInspectorRow; provider: ReturnType<typeof sanitizeProviderSummary> }) {
  const fields: [string, unknown][] = [
    ['Device code', device.public_device_code], ['Model', device.model], ['Platform', device.platform],
    ['Device status', deviceLifecycleStatus(device)], ['Online state', String(device.status ?? '').toLowerCase() === 'online' ? 'Online' : 'Offline / stale'],
    ['App version', device.app_version], ['App build', device.app_build], ['Last heartbeat', device.last_seen_at],
    ['Current route', device.current_route], ['Focus state', device.app_focus], ['Provider', provider.name],
    ['Provider health', provider.health],
  ];
  return <>
    <InspectorGrid title="Operational overview" fields={fields} />
    {hasLegacyActivationHistory(device) ? <InspectorGrid title="Legacy activation history" fields={[
      ['Activation source', device.activation_source],
      ['Historical expiration', device.activation_expires_at],
    ]} /> : null}
  </>;
}

function InspectorProvider({ summary }: { summary: ReturnType<typeof sanitizeProviderSummary> }) {
  return <InspectorGrid title="Provider assignment and health" fields={[
    ['Provider', summary.name], ['Provider ID', summary.id], ['Provider type', summary.type],
    ['Assignment status', summary.assignment], ['Assigned at', summary.assignedAt], ['Assignment acknowledgement', summary.acknowledgement],
    ['Health', summary.health], ['Provider expiration', summary.expiration], ['Inventory', summary.inventory], ['EPG', summary.epg], ['Last provider check', summary.lastCheck],
  ]} />;
}

function InspectorPlayback({ playback }: { playback: ReturnType<typeof readPlaybackSummary> }) {
  if (!playback.available) return <EmptyInspector title="Playback" text="Data unavailable for this device." />;
  return <InspectorGrid title="Recent playback" fields={playback.fields} />;
}

function InspectorActivity({ activity }: { activity: ReturnType<typeof buildDeviceActivity> }) {
  if (!activity.length) return <EmptyInspector title="Activity" text="No activity sources are available for this device." />;
  return <section className="inspectorPanel"><header><h3>Device activity</h3><span>Read-only operational events</span></header><div className="inspectorTimeline">{activity.map((entry) => <article key={entry.id}><i /><div><strong>{entry.label}</strong><small>{entry.detail}</small></div><time>{entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'Time unavailable'}</time></article>)}</div></section>;
}

function InspectorGrid({ title, fields }: { title: string; fields: [string, unknown][] }) {
  return <section className="inspectorPanel"><header><h3>{title}</h3><span>Reported data only</span></header><div className="inspectorGrid">{fields.map(([label, value]) => <div key={label}><small>{label}</small><strong>{value == null || value === '' ? 'Not reported' : String(value)}</strong></div>)}</div></section>;
}

function EmptyInspector({ title, text }: { title: string; text: string }) {
  return <section className="inspectorPanel inspectorEmpty"><h3>{title}</h3><p>{text}</p></section>;
}
