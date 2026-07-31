import type { ReactNode } from 'react';

type Row = Record<string, unknown>;
type DashboardData = Row & {
  devicesOnline?: number;
  activatedDevices?: number;
  providers?: number;
  pendingActivations?: number;
  pendingPairings?: number;
  recentErrors?: Row[];
  deviceStatuses?: { status: string; count: number }[];
  betaActivity?: { date: string; value: number }[];
  recentActivity?: { type: string; title: string; context?: string; timestamp: string }[];
  mostRecentDevice?: { displayName: string; timestamp: string } | null;
};

export function AdminDashboard({
  data,
  devices,
  invitations,
  providers,
  onNavigate,
  onRefresh,
  refreshing,
  onCreateInvite,
}: {
  data: DashboardData | null;
  devices: Row[];
  invitations: Row[];
  providers: Row[];
  onNavigate: (tab: 'devices' | 'invitations' | 'providers') => void;
  onRefresh: () => void;
  refreshing: boolean;
  onCreateInvite: () => void;
}) {
  const deviceCount = devices.length;
  const recent = data?.mostRecentDevice ?? deriveMostRecent(devices);
  const statuses = data?.deviceStatuses?.length ? data.deviceStatuses : deriveStatuses(devices);
  const activity = data?.recentActivity?.length ? data.recentActivity : deriveActivity(devices, invitations, providers);
  const chart = data?.betaActivity?.length ? data.betaActivity : deriveRegistrations(devices);
  const max = Math.max(...chart.map((point) => point.value), 1);
  const errors = data?.recentErrors?.length ?? 0;
  const metrics: { icon: string; label: string; value: ReactNode; detail: ReactNode; tone: string }[] = [
    { icon: 'devices-online', label: 'Devices online', value: data?.devicesOnline ?? 0, detail: 'Live heartbeat window', tone: 'blue' },
    { icon: 'providers', label: 'Providers', value: data?.providers ?? providers.length, detail: 'Active managed packages', tone: 'purple' },
    { icon: 'errors', label: 'Errors', value: errors, detail: errors ? 'Diagnostics reported' : 'No error feed configured', tone: 'red' },
    { icon: 'pending', label: 'Pending pairings', value: data?.pendingPairings ?? '', detail: 'Unexpired sessions only', tone: 'amber' },
    { icon: 'beta', label: 'Beta users', value: data?.activatedDevices ?? 0, detail: 'Activated devices', tone: 'green' },
    { icon: 'recent', label: 'Most recent device', value: recent?.displayName ?? 'No devices yet', detail: recent ? relativeTime(recent.timestamp) : 'Awaiting registration', tone: 'cyan' },
  ];

  return <div className="dashboardPage">
    <div className="metricGrid">{metrics.map((metric) => <Metric key={metric.label} {...metric} />)}</div>
    <div className="dashboardGrid">
      <Panel title="Devices overview" className="overviewPanel"><div className="donutLayout"><Donut statuses={statuses} total={deviceCount} /><div className="statusList">{statuses.length ? statuses.map((status) => <div className="statusRow" key={status.status}><i className={`dot dot-${status.status}`} /><span>{status.status}</span><strong>{status.count}</strong><small>{deviceCount ? `${Math.round((status.count / deviceCount) * 100)}%` : '0%'}</small></div>) : <Empty text="No device status data yet" />}</div></div><button className="textLink" onClick={() => onNavigate('devices')}>View all devices </button></Panel>
      <Panel title="Beta activity" action={<span className="panelSelect">Registrations  7 days</span>} className="activityPanel">{chart.length ? <div className="barChart" aria-label="Device registrations over the last seven days">{chart.map((point) => <div className="barItem" key={point.date} title={`${point.date}: ${point.value}`}><div className="barTrack"><div className="barFill" style={{ height: `${Math.max((point.value / max) * 100, point.value ? 8 : 2)}%` }} /></div><small>{formatDay(point.date)}</small></div>)}</div> : <Empty text="Historical activity will appear after device registrations." />}<button className="textLink" onClick={() => onNavigate('devices')}>View device activity </button></Panel>
      <Panel title="Recent activity" className="recentPanel">{activity.length ? <div className="activityList">{activity.slice(0, 5).map((item) => <div className="activityItem" key={`${item.type}-${item.timestamp}`}><span className={`activityIcon ${item.type}`}>{item.type === 'error' ? '!' : item.type === 'activation' ? '' : ''}</span><div><strong>{item.title}</strong><small>{item.context ?? 'NovaCast Cloud Admin'}</small></div><time>{relativeTime(item.timestamp)}</time></div>)}</div> : <Empty text="No activity events are available yet." />}<button className="textLink" onClick={() => onNavigate('devices')}>View all activity </button></Panel>
    </div>
    <Panel title="Quick actions" className="quickPanel"><div className="quickActions"><QuickAction icon="" label="Create invitation" onClick={onCreateInvite} /><QuickAction icon="" label="Add provider" onClick={() => onNavigate('providers')} /><QuickAction icon="" label="View devices" onClick={() => onNavigate('devices')} /><QuickAction icon="" label="Send announcement" disabled /><QuickAction icon="" label="System health" onClick={onRefresh} /><QuickAction icon="" label="Export report" onClick={() => exportReport(data, devices, invitations, providers)} /></div></Panel>
    <div className="dashboardFoot"><span>{data?.lastUpdatedAt ? `Last data update ${relativeTime(String(data.lastUpdatedAt))}` : 'Dashboard data is secured by NovaCast admin APIs.'}</span><button onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Refreshing' : 'Refresh dashboard'}</button></div>
  </div>;
}

function Metric({ icon, label, value, detail, tone }: { icon: string; label: string; value: ReactNode; detail: ReactNode; tone: string }) { return <article className={`metricCard tone-${tone}`}><div className="metricIcon">{icon === 'errors' ? '!' : icon === 'recent' ? '' : icon === 'providers' ? '' : icon === 'pending' ? '' : icon === 'beta' ? '' : ''}</div><span className="metricLabel">{label}</span><strong className="metricValue">{value}</strong><small>{detail}</small></article>; }
function Panel({ title, action, children, className = '' }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) { return <section className={`dashPanel ${className}`}><header><h2>{title}</h2>{action}</header>{children}</section>; }
function QuickAction({ icon, label, onClick, disabled = false }: { icon: string; label: string; onClick?: () => void; disabled?: boolean }) { return <button className="quickAction" onClick={onClick} disabled={disabled}><span>{icon}</span>{label}{disabled ? <small>Coming soon</small> : null}</button>; }
function Donut({ statuses, total }: { statuses: { status: string; count: number }[]; total: number }) { const colors = ['#18d7ff', '#7c3aed', '#10b981', '#f59e0b', '#ef4444']; const sum = Math.max(statuses.reduce((total, item) => total + item.count, 0), 1); let cursor = 0; const stops = statuses.map((item, index) => { const start = cursor; cursor += (item.count / sum) * 360; return `${colors[index % colors.length]} ${start}deg ${cursor}deg`; }).join(', '); return <div className="donut" style={{ background: statuses.length ? `conic-gradient(${stops})` : 'conic-gradient(#273653 0 360deg)' }}><div><strong>{total}</strong><small>Total devices</small></div></div>; }
function Empty({ text }: { text: string }) { return <p className="emptyState">{text}</p>; }
function relativeTime(value: string) { const time = Date.parse(value); if (!Number.isFinite(time)) return 'Unknown time'; const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000)); if (minutes < 1) return 'Just now'; if (minutes < 60) return `${minutes}m ago`; const hours = Math.floor(minutes / 60); if (hours < 24) return `${hours}h ago`; return `${Math.floor(hours / 24)}d ago`; }
function formatDay(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3); }
function deriveStatuses(devices: Row[]) { const cutoff = Date.now() - 30 * 60 * 1000; const counts = new Map<string, number>(); for (const device of devices) { const activation = String(device.activation_status ?? 'inactive'); const status = String(device.status ?? 'active'); const lastSeen = Date.parse(String(device.last_seen_at ?? '')); const category = ['revoked', 'disabled'].includes(status) ? 'revoked' : activation === 'expired' ? 'expired' : activation !== 'active' ? 'pending' : lastSeen >= cutoff ? 'online' : 'offline'; counts.set(category, (counts.get(category) ?? 0) + 1); } return [...counts.entries()].map(([status, count]) => ({ status, count })); }
function deriveRegistrations(devices: Row[]) { if (!devices.some((device) => typeof device.created_at === 'string')) return []; const points = Array.from({ length: 7 }, (_, index) => { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - (6 - index)); return { date: date.toISOString(), value: 0 }; }); for (const device of devices) { const time = Date.parse(String(device.created_at ?? '')); const point = points.find((candidate) => { const start = Date.parse(candidate.date); return time >= start && time < start + 86400000; }); if (point) point.value += 1; } return points; }
function deriveActivity(devices: Row[], invitations: Row[], providers: Row[]) { const entries: { type: string; title: string; context?: string; timestamp: string }[] = []; devices.forEach((device) => { const timestamp = String(device.updated_at ?? device.created_at ?? ''); if (timestamp) entries.push({ type: device.activation_status === 'active' ? 'activation' : 'device', title: device.activation_status === 'active' ? 'Device activated' : 'Device registered', context: String(device.friendly_name ?? device.model ?? device.public_device_code ?? 'NovaCast device'), timestamp }); }); invitations.forEach((invite) => { const timestamp = String(invite.created_at ?? ''); if (timestamp) entries.push({ type: 'invite', title: 'Invitation created', context: String(invite.display_label ?? 'Beta invitation'), timestamp }); }); providers.forEach((provider) => { const timestamp = String(provider.created_at ?? ''); if (timestamp) entries.push({ type: 'provider', title: 'Provider package added', context: String(provider.display_name ?? provider.slug ?? 'Managed provider'), timestamp }); }); return entries.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 8); }
function deriveMostRecent(devices: Row[]) { const latest = [...devices].sort((a, b) => Date.parse(String(b.last_seen_at ?? b.created_at ?? 0)) - Date.parse(String(a.last_seen_at ?? a.created_at ?? 0)))[0]; if (!latest) return null; return { displayName: String(latest.friendly_name ?? latest.model ?? latest.public_device_code ?? 'NovaCast device'), timestamp: String(latest.last_seen_at ?? latest.created_at ?? '') }; }
function exportReport(data: DashboardData | null, devices: Row[], invitations: Row[], providers: Row[]) { const safe = { exportedAt: new Date().toISOString(), dashboard: data, devices: devices.map(({ id, public_device_code, friendly_name, model, platform, status, activation_status, last_seen_at, created_at }) => ({ id, public_device_code, friendly_name, model, platform, status, activation_status, last_seen_at, created_at })), invitations, providers }; const blob = new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `novacast-dashboard-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(link.href); }
