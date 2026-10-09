import { FormEvent, useCallback, useEffect, useState } from 'react';

import { AdminDashboard } from './AdminDashboard';
import { AdminDevices } from './AdminDevices';
import { AdminInvitations } from './AdminInvitations';
import { AdminProviders } from './AdminProviders';
import { AdminDiagnostics } from './AdminDiagnostics';
import { AdminPlayback } from './AdminPlayback';
import { AdminGoldPanel } from './AdminGoldPanel';
import { AdminAnnouncements } from './AdminAnnouncements';
import { AdminPairingOps } from './AdminPairingOps';
import { AdminNovaPulseOps } from './AdminNovaPulseOps';
import { AdminEpgOps } from './AdminEpgOps';
import { AdminReleases } from './AdminReleases';
import {
  formatProviderAssignmentMessage,
  resolveProviderAssignmentAckState,
} from './adminAssignmentCopy';
import { adminLogin, adminRequest } from './pairing';
import { shouldShowGlobalAdminHeaderAction } from './adminHeaderActions';
import { ADMIN_NAV_GROUPS, adminPathForDevice, adminPathForTab, resolveAdminLocation, type AdminTab, type DeviceInspectorTab } from './adminNavigation';
import { DeviceInspector } from './DeviceInspector';
import { resolveDeviceRecord } from './deviceInspectorModel';

type Row = Record<string, unknown>;
type InvitationInput = {
  label: string;
  maximumDevices: number;
  durationHours: number;
  managedProviderId: string;
};
type DeviceQuery = { page: number; pageSize: number; search: string; status: string; platform: string; activation: string; version: string; providerId: string; providerHealth: string };
type DevicePagination = { page: number; pageSize: number; total: number; totalPages: number };
type ProviderQuery = { page: number; pageSize: number; search: string; health: string; type: string; managed: string; gold: string };
type ProviderPagination = { page: number; pageSize: number; total: number; totalPages: number; summary: Record<string, number> };
const DEFAULT_DEVICE_QUERY: DeviceQuery = { page: 1, pageSize: 25, search: '', status: 'all', platform: 'all', activation: 'all', version: '', providerId: '', providerHealth: 'all' };
const DEFAULT_PROVIDER_QUERY: ProviderQuery = { page: 1, pageSize: 25, search: '', health: 'all', type: 'all', managed: 'all', gold: 'all' };

function adminDevicesPath(query: DeviceQuery) {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (query.search) params.set('search', query.search);
  if (query.status !== 'all') params.set('status', query.status);
  if (query.platform !== 'all') params.set('platform', query.platform);
  if (query.activation !== 'all') params.set('activation', query.activation);
  if (query.version) params.set('version', query.version);
  if (query.providerId) params.set('providerId', query.providerId);
  if (query.providerHealth !== 'all') params.set('providerHealth', query.providerHealth);
  return `admin-devices?${params.toString()}`;
}

function adminProvidersPath(query: ProviderQuery) {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) });
  if (query.search) params.set('search', query.search);
  if (query.health !== 'all') params.set('health', query.health);
  if (query.type !== 'all') params.set('type', query.type);
  if (query.managed !== 'all') params.set('managed', query.managed);
  if (query.gold !== 'all') params.set('gold', query.gold);
  return `admin-providers?${params.toString()}`;
}

export function AdminCloud() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState(() => sessionStorage.getItem('novacast-admin-token') ?? '');
  const [location, setLocation] = useState(() => resolveAdminLocation(window.location.pathname));
  const tab = location.tab;
  const selectedDeviceCode = location.deviceKey;
  const inspectorTab = location.inspectorTab;
  const [devices, setDevices] = useState<Row[]>([]);
  const [deviceQuery, setDeviceQuery] = useState<DeviceQuery>(DEFAULT_DEVICE_QUERY);
  const [devicePagination, setDevicePagination] = useState<DevicePagination>({ page: 1, pageSize: 25, total: 0, totalPages: 0 });
  const [invitations, setInvitations] = useState<Row[]>([]);
  const [providers, setProviders] = useState<Row[]>([]);
  const [providerQuery, setProviderQuery] = useState<ProviderQuery>(DEFAULT_PROVIDER_QUERY);
  const [providerPagination, setProviderPagination] = useState<ProviderPagination>({ page: 1, pageSize: 25, total: 0, totalPages: 0, summary: {} });
  const [dashboard, setDashboard] = useState<Row | null>(null);
  const [goldAccounts, setGoldAccounts] = useState<Row[]>([]);
  const [goldReseller, setGoldReseller] = useState<Row | null>(null);
  const [releaseSummary, setReleaseSummary] = useState<Row | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openCreateInvite, setOpenCreateInvite] = useState(false);
  const [openAddProvider, setOpenAddProvider] = useState(false);
  const [openAddGold, setOpenAddGold] = useState(false);

  const load = useCallback(async (nextToken: string, quiet = false, requestedDeviceQuery: DeviceQuery = DEFAULT_DEVICE_QUERY, requestedProviderQuery: ProviderQuery = DEFAULT_PROVIDER_QUERY) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);

    try {
      const [deviceResult, inviteResult, providerResult, dashboardResult, goldResult, resellerResult, releaseResult] = await Promise.all([
        adminRequest(adminDevicesPath(requestedDeviceQuery), nextToken),
        adminRequest('admin-invites', nextToken),
        adminRequest(adminProvidersPath(requestedProviderQuery), nextToken).catch(() => ({ providers: [] })),
        adminRequest('admin-dashboard', nextToken).catch(() => null),
        adminRequest('admin-gold-panel', nextToken).catch(() => ({ accounts: [] })),
        adminRequest('admin-gold-panel', nextToken, { method: 'POST', body: JSON.stringify({ action: 'reseller' }) }).catch(() => null),
        adminRequest('admin-releases?pageSize=25', nextToken).catch(() => null),
      ]);

      setDevices(Array.isArray(deviceResult.items) ? deviceResult.items : Array.isArray(deviceResult.devices) ? deviceResult.devices : []);
      setDevicePagination({ page: Number(deviceResult.page ?? requestedDeviceQuery.page), pageSize: Number(deviceResult.pageSize ?? requestedDeviceQuery.pageSize), total: Number(deviceResult.total ?? 0), totalPages: Number(deviceResult.totalPages ?? 0) });
      setInvitations(Array.isArray(inviteResult.invitations) ? inviteResult.invitations : []);
      setProviders(Array.isArray(providerResult.providers) ? providerResult.providers : []);
      setProviderPagination({ page: Number(providerResult.page ?? requestedProviderQuery.page), pageSize: Number(providerResult.pageSize ?? requestedProviderQuery.pageSize), total: Number(providerResult.total ?? 0), totalPages: Number(providerResult.totalPages ?? 0), summary: (providerResult.summary && typeof providerResult.summary === 'object' ? providerResult.summary : {}) as Record<string, number> });
      // admin-dashboard returns { serverTime, dashboard: {...} }; keep the inner core.
      setDashboard(dashboardResult && typeof dashboardResult === 'object' && dashboardResult.dashboard ? dashboardResult.dashboard : dashboardResult);
      setGoldAccounts(Array.isArray(goldResult?.accounts) ? goldResult.accounts : []);
      setGoldReseller(resellerResult?.reseller ?? null);
      setReleaseSummary(releaseResult?.production ?? null);
    } catch (error) {
      const category = error instanceof Error ? error.message : 'admin_request_failed';
      if (category === 'admin_unauthorized') {
        sessionStorage.removeItem('novacast-admin-token');
        setToken('');
        setMessage('Your administrator session expired. Sign in again.');
      } else {
        setMessage('Cloud Admin could not refresh its data.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const updateDeviceQuery = useCallback((next: DeviceQuery) => {
    setDeviceQuery(next);
    if (token) void load(token, true, next, providerQuery);
  }, [load, providerQuery, token]);

  const updateProviderQuery = useCallback((next: ProviderQuery) => {
    setProviderQuery(next);
    if (token) void load(token, true, deviceQuery, next);
  }, [deviceQuery, load, token]);

  useEffect(() => {
    // Admin dashboard hydration is an external request lifecycle.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (token && tab !== 'diagnostics') void load(token, false, deviceQuery, providerQuery);
  }, [deviceQuery, load, providerQuery, tab, token]);

  useEffect(() => {
    const onPopState = () => setLocation(resolveAdminLocation(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigateTab = useCallback((next: AdminTab) => {
    window.history.pushState({}, '', adminPathForTab(next));
    setLocation({ tab: next });
  }, []);

  const navigateDevice = useCallback((key: string, nextTab: DeviceInspectorTab = 'overview') => {
    window.history.pushState({}, '', adminPathForDevice(key, nextTab));
    setLocation({ tab: 'devices', deviceKey: key, inspectorTab: nextTab });
  }, []);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    setLoading(true);
    try {
      const nextToken = await adminLogin(email, password);
      sessionStorage.setItem('novacast-admin-token', nextToken);
      setToken(nextToken);
      setPassword('');
    } catch {
      setMessage('Administrator sign-in failed.');
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    sessionStorage.removeItem('novacast-admin-token');
    setToken('');
    setDevices([]);
    setDeviceQuery(DEFAULT_DEVICE_QUERY);
    setDevicePagination({ page: 1, pageSize: 25, total: 0, totalPages: 0 });
    setInvitations([]);
    setProviders([]);
    setProviderQuery(DEFAULT_PROVIDER_QUERY);
    setProviderPagination({ page: 1, pageSize: 25, total: 0, totalPages: 0, summary: {} });
    setDashboard(null);
    setGoldAccounts([]);
    setGoldReseller(null);
    setReleaseSummary(null);
  };

  const command = async (id: string) => {
    try {
      await adminRequest('admin-device-action', token, {
        method: 'POST',
        body: JSON.stringify({ deviceId: id, action: 'refresh_library' }),
      });
      setMessage('Library refresh command queued.');
    } catch {
      setMessage('The device command could not be queued.');
    }
  };

  const revoke = async (id: string) => {
    if (!window.confirm('Revoke this NovaCast device?')) return;
    try {
      await adminRequest('admin-device-action', token, {
        method: 'POST',
        body: JSON.stringify({ deviceId: id, action: 'revoke' }),
      });
      setMessage('Device revoked.');
      await load(token, true);
    } catch {
      setMessage('The device could not be revoked.');
    }
  };

  const assignProvider = async (id: string, managedProviderId: string) => {
    try {
      const result = await adminRequest('admin-device-action', token, {
        method: 'POST',
        body: JSON.stringify({
          deviceId: id,
          action: 'assign_provider',
          managedProviderId,
        }),
      });
      const providerName =
        typeof result.providerName === 'string' ? result.providerName : 'selected provider';
      const deviceOnline = result.deviceOnline === true;
      setMessage(
        formatProviderAssignmentMessage({
          providerName,
          unchanged: result.unchanged === true,
          deviceOnline,
          ackState: result.unchanged === true ? 'applied' : deviceOnline ? 'updating' : 'pending',
        }),
      );
      await load(token, true);
      if (result.unchanged === true) {
        return;
      }
      const assignmentId = typeof result.assignmentId === 'string' ? result.assignmentId : '';
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const latest = await adminRequest('admin-devices', token).catch(() => null);
        const devices = Array.isArray(latest?.devices) ? latest.devices : [];
        const updated = devices.find((device: Row) => String(device.id ?? '') === id);
        if (!updated) {
          continue;
        }
        setDevices(devices);
        const ackState = resolveProviderAssignmentAckState({
          assignment_id: assignmentId || updated.assignment_id,
          assignment_command_status: updated.assignment_command_status,
          applied_assignment_id: updated.applied_assignment_id,
          assignment_applied_at: updated.assignment_applied_at,
        });
        if (ackState === 'applied') {
          setMessage(formatProviderAssignmentMessage({ providerName, ackState: 'applied' }));
          return;
        }
      }
    } catch (error) {
      const category = error instanceof Error ? error.message : 'admin_update_failed';
      setMessage('Provider could not be changed (' + category + ').');
    }
  };

  const createInvitation = async (input: InvitationInput) => {
    const result = await adminRequest('admin-invites', token, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    await load(token, true);
    return String(result.code ?? '');
  };

  if (!token) {
    return (
      <main className="cloudLoginShell">
        <section className="cloudLoginCard">
          <div className="cloudLoginBrand">
            <img src="/novacast-logo.png" alt="NovaCast" />
            <div>
              <strong>NOVACAST</strong>
              <small>CLOUD ADMIN</small>
            </div>
          </div>
          <span className="cloudLoginEyebrow">SECURE OPERATIONS CONSOLE</span>
          <h1>Administrator sign in</h1>
          <p>Manage NovaCast devices, providers, content, and platform operations.</p>
          <form onSubmit={login}>
            <label>
              Email
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {message ? <div className="cloudAdminNotice error">{message}</div> : null}
            <button className="submit" disabled={loading}>
              {loading ? 'Signing in' : 'Sign in'}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <div className="cloudAdmin">
      <aside className="cloudSidebar">
        <div className="cloudBrand">
          <img src="/novacast-logo.png" alt="NovaCast" />
          <div>
            <strong>NOVACAST</strong>
            <small>CLOUD ADMIN</small>
          </div>
        </div>

        <nav aria-label="Operations Console">
          {ADMIN_NAV_GROUPS.map((group, groupIndex) => (
            <div className="adminNavGroup" key={group.label ?? `primary-${groupIndex}`}>
              {group.label ? <span className="adminNavGroupLabel">{group.label}</span> : null}
              {group.items.map((item) => (
                <NavButton
                  key={item.id}
                  active={item.tab === tab}
                  icon={item.icon}
                  label={item.label}
                  disabled={item.disabled}
                  note={item.note}
                  href={item.href}
                  onClick={item.tab ? () => navigateTab(item.tab!) : undefined}
                />
              ))}
            </div>
          ))}
        </nav>

        <div className="cloudSidebarFooter">
          <span><i /> Cloud services online</span>
          <button onClick={logout}>Sign out</button>
        </div>
      </aside>

      <main className="cloudMain">
        <header className="cloudTopbar">
          <div>
            <span className="cloudTopEyebrow">NOVACAST OPERATIONS</span>
            <h1>{titleFor(tab)}</h1>
            <p>{subtitleFor(tab)}</p>
          </div>
          <div className="cloudTopActions">
            {shouldShowGlobalAdminHeaderAction(tab, 'refresh') ? (
              <button onClick={() => { if (tab !== 'diagnostics') void load(token, true, deviceQuery, providerQuery); }} disabled={refreshing || tab === 'diagnostics'}>
                {refreshing ? 'Refreshing' : ' Refresh'}
              </button>
            ) : null}
            {shouldShowGlobalAdminHeaderAction(tab, 'new_invitation') ? (
              <button className="cloudPrimary" onClick={() => { navigateTab('invitations'); setOpenCreateInvite(true); }}>
                 New invitation
              </button>
            ) : null}
          </div>
        </header>

        {message ? (
          <div className="cloudAdminNotice" role="status" aria-live="polite">
            <span>{message}</span>
            <button aria-label="Dismiss message" onClick={() => setMessage('')}></button>
          </div>
        ) : null}

        {loading ? <div className="cloudLoading">Loading NovaCast Cloud Admin</div> : null}

        {!loading && tab === 'dashboard' ? (
          <AdminDashboard
            data={dashboard}
            devices={devices}
            invitations={invitations}
            providers={providers}
            goldAccounts={goldAccounts}
            goldReseller={goldReseller}
            releaseSummary={releaseSummary}
            onNavigate={(next) => navigateTab(next === 'analytics' ? 'diagnostics' : next)}
            onAddProvider={() => { navigateTab('providers'); setOpenAddProvider(true); }}
            onAddGoldAccount={() => { navigateTab('gold'); setOpenAddGold(true); }}
            onOpenDevice={(code, nextTab) => navigateDevice(code, nextTab ?? 'overview')}
            onRefresh={() => void load(token, true)}
            refreshing={refreshing}
            onCreateInvite={() => { navigateTab('invitations'); setOpenCreateInvite(true); }}
          />
        ) : null}

        {!loading && tab === 'devices' && selectedDeviceCode ? (() => {
          const selectedDevice = resolveDeviceRecord(devices, selectedDeviceCode);
          if (!selectedDevice) return <div className="deviceEmpty">Device data is unavailable. Return to the device list and refresh.</div>;
          const selectedProvider = providers.find((provider) => String(provider.id ?? '') === String(selectedDevice.managed_provider_id ?? '')) ?? null;
          return <DeviceInspector
            token={token}
            device={selectedDevice}
            provider={selectedProvider}
            initialTab={inspectorTab}
            onBack={() => navigateTab('devices')}
            onTabChange={(next) => navigateDevice(selectedDeviceCode, next)}
          />;
        })() : null}
        {!loading && tab === 'devices' && !selectedDeviceCode ? (
          <AdminDevices
            devices={devices}
            providers={providers}
            onAssignProvider={(id, managedProviderId) => void assignProvider(id, managedProviderId)}
            onCommand={(id) => void command(id)}
            onRevoke={(id) => void revoke(id)}
            onMessage={setMessage}
            onView={(device) => navigateDevice(String(device.public_device_code ?? device.id ?? ''))}
            pagination={devicePagination}
            query={deviceQuery}
            onQueryChange={updateDeviceQuery}
          />
        ) : null}

        {!loading && tab === 'invitations' ? (
          <AdminInvitations
            invitations={invitations}
            providers={providers}
            onCreate={createInvitation}
            onMessage={setMessage}
            openCreate={openCreateInvite}
            onOpenCreateHandled={() => setOpenCreateInvite(false)}
          />
        ) : null}

        {!loading && tab === 'providers' ? (
          <AdminProviders
            token={token}
            providers={providers}
            onRefresh={() => load(token, true, deviceQuery, providerQuery)}
            onMessage={setMessage}
            pagination={providerPagination}
            query={providerQuery}
            onQueryChange={updateProviderQuery}
            openCreate={openAddProvider}
            onOpenCreateHandled={() => setOpenAddProvider(false)}
          />
        ) : null}
        {!loading && tab === 'diagnostics' ? (
          <AdminDiagnostics token={token} onMessage={setMessage} onOpenDevice={(code) => navigateDevice(code, 'diagnostics')} />
        ) : null}
        {!loading && tab === 'playback' ? <AdminPlayback token={token} devices={devices} providers={providers} onOpenDevice={(code) => navigateDevice(code, 'playback')} /> : null}
        {!loading && tab === 'announcements' ? <AdminAnnouncements token={token} onMessage={setMessage} /> : null}
        {!loading && tab === 'pairingOps' ? <AdminPairingOps token={token} /> : null}
        {!loading && tab === 'novapulseOps' ? <AdminNovaPulseOps token={token} /> : null}
        {!loading && tab === 'epgOps' ? <AdminEpgOps token={token} /> : null}
        {!loading && tab === 'releases' ? <AdminReleases token={token} onOpenDevice={(code) => navigateDevice(code, 'overview')} /> : null}
        {!loading && tab === 'gold' ? <AdminGoldPanel token={token} devices={devices} providers={providers} openCreate={openAddGold} onOpenCreateHandled={() => setOpenAddGold(false)} onAssignProvider={(id, providerId) => void assignProvider(id, providerId)} onMessage={setMessage} /> : null}
        {!loading && tab === 'settings' ? (
          <ComingSoon title="Cloud Admin settings" text="Administrator preferences and platform controls will appear here." />
        ) : null}
      </main>
    </div>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick,
  disabled,
  note,
  href,
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  note?: string;
  href?: string;
}) {
  const content = <><span>{icon}</span><span className="adminNavLabel">{label}</span>{note ? <small>{note}</small> : null}</>;
  if (href) return <a className={`adminNavButton ${active ? 'active' : ''}`} href={href}>{content}</a>;
  return (
    <button className={active ? 'active' : ''} onClick={onClick} disabled={disabled} aria-disabled={disabled || undefined}>
      <span>{icon}</span>
      <span className="adminNavLabel">{label}</span>
      {note ? <small>{note}</small> : null}
    </button>
  );
}

function ComingSoon({ title, text }: { title: string; text: string }) {
  return (
    <section className="cloudSimplePanel comingSoon">
      <span>COMING SOON</span>
      <h2>{title}</h2>
      <p>{text}</p>
    </section>
  );
}

function titleFor(tab: AdminTab) {
  return {
    dashboard: 'Overview',
    devices: 'Devices',
    providers: 'Providers',
    gold: 'Gold Panel',
    invitations: 'Release Testing',
    announcements: 'NovaPulse Announcements',
    pairingOps: 'Pairing Operations',
    novapulseOps: 'NovaPulse Operations',
    epgOps: 'EPG Operations',
    releases: 'Release Operations',
    diagnostics: 'Diagnostics',
    playback: 'Playback',
    settings: 'Settings',
  }[tab];
}

function subtitleFor(tab: AdminTab) {
  return {
    dashboard: 'Live operational health across NovaCast devices, providers, and Gold reseller capacity.',
    devices: 'Manage and monitor all registered NovaCast devices.',
    providers: 'Add, validate, and activate managed IPTV providers for NovaCast operations.',
    gold: 'Provision and monitor Gold reseller accounts linked to NovaCast providers.',
    invitations: 'Manage controlled release access and invitation capacity.',
    announcements: 'Create, schedule, and preview safe NovaPulse TV announcements.',
    pairingOps: 'Inspect bounded pairing health without exposing redemption or credential material.',
    novapulseOps: 'Review feed freshness and persisted content operations signals.',
    epgOps: 'Review provider guide coverage, freshness, and refresh results.',
    releases: 'Review explicit production metadata and observed device adoption.',
    diagnostics: 'Review device health and operational diagnostics.',
    playback: 'Review recent persisted playback issues from the device fleet.',
    settings: 'Configure NovaCast Cloud Admin.',
  }[tab];
}
