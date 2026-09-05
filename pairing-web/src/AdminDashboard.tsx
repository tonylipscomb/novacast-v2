import type { ReactNode } from 'react';

import { formatCount, formatTimestamp } from './providerHealthDisplay';
import {
  deriveDeviceSupportRows,
  deriveGoldSummary,
  deriveOpsSummary,
  deriveProviderHealthSummary,
  deriveReleaseReadiness,
  readDashboardCore,
  type Row,
  type StatusTone,
} from './operationsCenter';

type DashboardNavTarget = 'devices' | 'invitations' | 'providers' | 'gold' | 'analytics';

export function AdminDashboard({
  data,
  devices,
  invitations,
  providers,
  goldAccounts,
  goldReseller,
  onNavigate,
  onRefresh,
  refreshing,
  onCreateInvite,
  onAddProvider,
  onAddGoldAccount,
}: {
  data: Row | null;
  devices: Row[];
  invitations: Row[];
  providers: Row[];
  goldAccounts: Row[];
  goldReseller: Row | null;
  onNavigate: (tab: DashboardNavTarget) => void;
  onRefresh: () => void;
  refreshing: boolean;
  onCreateInvite: () => void;
  onAddProvider?: () => void;
  onAddGoldAccount?: () => void;
}) {
  const core = readDashboardCore(data);
  const providerHealth = deriveProviderHealthSummary(providers);
  const gold = deriveGoldSummary(goldAccounts, goldReseller);
  const summary = deriveOpsSummary({ core, providerHealth, gold, deviceCount: devices.length });
  const readiness = deriveReleaseReadiness({ core, providerHealth, gold, deviceCount: devices.length });
  const supportRows = deriveDeviceSupportRows(devices);
  const providerById = new Map(providers.map((provider) => [String(provider.id), provider]));
  const activity = deriveActivity(devices, invitations, providers);
  const currentBuild = typeof core.currentBetaBuild === 'string' ? core.currentBetaBuild : null;

  return (
    <div className="opsPage">
      <div className="opsSummary">
        {summary.map((metric) => (
          <article key={metric.id} className={`opsMetric tone-${metric.tone}`}>
            <span className="opsMetricLabel">{metric.label}</span>
            <strong className="opsMetricValue">{metric.value}</strong>
            <small>{metric.detail}</small>
          </article>
        ))}
      </div>

      <div className="opsGrid">
        <Panel
          title="Gold operations"
          subtitle="Reseller capacity and Gold-linked providers"
          actions={
            <>
              <button className="opsGhost" onClick={() => onNavigate('gold')}>Open Gold Panel</button>
              <button className="opsPrimarySm" onClick={onAddGoldAccount ?? (() => onNavigate('gold'))}>Add Gold Account</button>
            </>
          }>
          <div className="opsStatRow">
            <Stat label="Reseller credits" value={gold.credits === null ? '\u2014' : gold.credits} tone={gold.credits === null ? 'neutral' : gold.credits <= 0 ? 'critical' : gold.credits <= 5 ? 'warning' : 'healthy'} />
            <Stat label="Managed accounts" value={gold.total} tone="neutral" />
            <Stat label="Active" value={gold.active} tone="healthy" />
            <Stat label="Expiring 7d" value={gold.expiringSoon} tone={gold.expiringSoon ? 'warning' : 'neutral'} />
            <Stat label="Expired" value={gold.expired} tone={gold.expired ? 'critical' : 'neutral'} />
            <Stat label="Unassigned" value={gold.unassignedDevice} tone={gold.unassignedDevice ? 'warning' : 'neutral'} />
          </div>
          <div className="opsMicroNotes">
            {gold.resellerEnabled === false ? <span className="opsFlag critical">Reseller connection disabled</span> : null}
            {gold.unassignedProvider ? <span className="opsFlag warning">{gold.unassignedProvider} without a NovaCast provider</span> : null}
            {gold.routeAlertsReliable ? (
              <span className={`opsFlag ${gold.routeAlerts ? 'warning' : 'ok'}`}>{gold.routeAlerts} route alerts</span>
            ) : (
              <span className="opsFlag muted">Route health checked per-account in Gold Panel</span>
            )}
          </div>
        </Panel>

        <Panel
          title="Provider health"
          subtitle="Shared health semantics from Providers"
          actions={<button className="opsGhost" onClick={() => onNavigate('providers')}>View Providers</button>}>
          <div className="opsStatRow">
            <Stat label="Healthy" value={providerHealth.healthy} tone="healthy" />
            <Stat label="Needs attention" value={providerHealth.needsAttention} tone={providerHealth.needsAttention ? 'warning' : 'neutral'} />
            <Stat label="Draft" value={providerHealth.draft} tone="neutral" />
            <Stat label="Gold managed" value={providerHealth.goldManaged} tone="neutral" />
          </div>
          {providerHealth.unhealthy.length ? (
            <ul className="opsList">
              {providerHealth.unhealthy.slice(0, 4).map((provider) => (
                <li key={provider.id}>
                  <span className={`opsDot dot-${provider.tone}`} />
                  <span className="opsListName">{provider.name}</span>
                  {provider.goldManaged ? <span className="opsTag">GOLD</span> : null}
                  <b className={`opsBadge tone-${provider.tone}`}>{provider.label}</b>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="All providers are healthy." />
          )}
        </Panel>
      </div>

      <div className="opsGrid opsGridWide">
        <Panel
          title="Devices & support"
          subtitle="Offline and unassigned devices first"
          actions={<button className="opsGhost" onClick={() => onNavigate('devices')}>View devices</button>}>
          {supportRows.length ? (
            <div className="opsTableWrap">
              <table className="opsTable">
                <thead>
                  <tr><th>Device</th><th>Status</th><th>Provider</th><th>Build</th><th>Last seen</th></tr>
                </thead>
                <tbody>
                  {supportRows.map((row) => {
                    const provider = row.assignedProviderId ? providerById.get(row.assignedProviderId) : null;
                    return (
                      <tr key={row.id}>
                        <td>
                          <strong>{row.code}</strong>
                          <small>{row.name}</small>
                        </td>
                        <td>
                          <span className={`opsPillState ${row.online ? 'ok' : 'off'}`}>{row.online ? 'Online' : 'Offline'}</span>
                          {row.activationStatus !== 'active' ? <small className="opsSub">{row.activationStatus}</small> : null}
                        </td>
                        <td>
                          {provider ? String(provider.display_name ?? '\u2014') : <span className="opsSub warning">Unassigned</span>}
                          {row.assignmentState && row.assignmentState !== 'completed' ? <small className="opsSub">{row.assignmentState}</small> : null}
                        </td>
                        <td>{row.appVersion ? `${row.appVersion}${row.appBuild ? ` (${row.appBuild})` : ''}` : '\u2014'}</td>
                        <td>{row.lastSeen ? relativeTime(row.lastSeen) : 'Never'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty text="No devices registered yet." />
          )}
        </Panel>

        <Panel title="Release readiness" subtitle="Real service signals - not a score">
          <ul className="opsReadiness">
            {readiness.map((signal) => (
              <li key={signal.id}>
                <span className={`opsDot dot-${signal.tone}`} />
                <span className="opsListName">{signal.label}</span>
                <b className={`opsBadge tone-${signal.tone}`}>{signal.state}</b>
                {signal.detail ? <small>{signal.detail}</small> : null}
              </li>
            ))}
          </ul>
          <div className="opsBuildHook">
            <span>Latest reported build</span>
            <strong>{currentBuild ?? 'Unknown'}</strong>
            {/* Distribution/download rollout metadata is not yet exposed to Cloud Admin. */}
            <small className="opsSub">Highest app build currently reported by registered devices</small>
          </div>
        </Panel>
      </div>

      <div className="opsGrid opsGridWide">
        <Panel title="Recent activity" subtitle="Latest platform events">
          {activity.length ? (
            <ul className="opsActivity">
              {activity.slice(0, 6).map((item) => (
                <li key={`${item.type}-${item.timestamp}`}>
                  <span className={`opsDot dot-${item.type === 'error' ? 'critical' : item.type === 'activation' ? 'healthy' : 'neutral'}`} />
                  <div>
                    <strong>{item.title}</strong>
                    <small>{item.context ?? 'NovaCast Cloud Admin'}</small>
                  </div>
                  <time>{relativeTime(item.timestamp)}</time>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="No activity events available yet." />
          )}
        </Panel>

        <Panel title="Quick actions" subtitle="Common operations">
          <div className="opsQuickGrid">
            <button className="opsQuick" onClick={onCreateInvite}>Create invitation</button>
            <button className="opsQuick" onClick={onAddProvider ?? (() => onNavigate('providers'))}>Add provider</button>
            <button className="opsQuick" onClick={onAddGoldAccount ?? (() => onNavigate('gold'))}>Add Gold account</button>
            <button className="opsQuick" onClick={() => onNavigate('analytics')}>Open diagnostics</button>
            <button className="opsQuick" onClick={() => exportReport(core, devices, invitations, providers, goldAccounts)}>Export report</button>
            <button className="opsQuick" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Refreshing...' : 'Refresh data'}</button>
          </div>
        </Panel>
      </div>

      <div className="opsFoot">
        <span>{core.serverTime ? `Server time ${formatTimestamp(core.serverTime)}` : 'Dashboard data is secured by NovaCast admin APIs.'}</span>
        <span className="opsFootMeta">{formatCount(providers.length)} providers {'\u00B7'} {formatCount(devices.length)} devices {'\u00B7'} {formatCount(gold.total)} Gold accounts</span>
      </div>
    </div>
  );
}

function Panel({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="opsPanel">
      <header>
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="opsPanelActions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone: StatusTone }) {
  return (
    <div className={`opsStat tone-${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="opsEmpty">{text}</p>;
}

function relativeTime(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'Unknown';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function deriveActivity(devices: Row[], invitations: Row[], providers: Row[]) {
  const entries: { type: string; title: string; context?: string; timestamp: string }[] = [];
  devices.forEach((device) => {
    const timestamp = String(device.updated_at ?? device.created_at ?? '');
    if (timestamp) {
      entries.push({
        type: device.activation_status === 'active' ? 'activation' : 'device',
        title: device.activation_status === 'active' ? 'Device activated' : 'Device registered',
        context: String(device.friendly_name ?? device.model ?? device.public_device_code ?? 'NovaCast device'),
        timestamp,
      });
    }
  });
  invitations.forEach((invite) => {
    const timestamp = String(invite.created_at ?? '');
    if (timestamp) entries.push({ type: 'invite', title: 'Invitation created', context: String(invite.display_label ?? 'Beta invitation'), timestamp });
  });
  providers.forEach((provider) => {
    const timestamp = String(provider.created_at ?? '');
                          {provider ? String(provider.display_name ?? '\u2014') : <span className="opsSub warning">Unassigned</span>}
  });
  return entries.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 8);
}

function exportReport(core: Row, devices: Row[], invitations: Row[], providers: Row[], goldAccounts: Row[]) {
  const safe = {
    exportedAt: new Date().toISOString(),
    dashboard: core,
    devices: devices.map(({ id, public_device_code, friendly_name, model, platform, status, activation_status, last_seen_at, created_at, app_version, app_build }) => ({ id, public_device_code, friendly_name, model, platform, status, activation_status, last_seen_at, created_at, app_version, app_build })),
    invitations,
    providers: providers.map(({ id, display_name, slug, status, health_status, validation_stale }) => ({ id, display_name, slug, status, health_status, validation_stale })),
    gold: goldAccounts.map(({ id, gold_user_id, gold_package_name, gold_expiration, gold_enabled, managed_provider_id }) => ({ id, gold_user_id, gold_package_name, gold_expiration, gold_enabled, managed_provider_id })),
  };
  const blob = new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `novacast-operations-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}
