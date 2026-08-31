import { FormEvent, useCallback, useEffect, useState } from 'react';

import { AdminDashboard } from './AdminDashboard';
import { AdminDevices } from './AdminDevices';
import { AdminInvitations } from './AdminInvitations';
import { AdminProviders } from './AdminProviders';
import { AdminDiagnostics } from './AdminDiagnostics';
import { AdminGoldPanel } from './AdminGoldPanel';
import {
  formatProviderAssignmentMessage,
  resolveProviderAssignmentAckState,
} from './adminAssignmentCopy';
import { adminLogin, adminRequest } from './pairing';

type Row = Record<string, unknown>;
type AdminTab = 'dashboard' | 'devices' | 'providers' | 'gold' | 'invitations' | 'analytics' | 'settings';

type InvitationInput = {
  label: string;
  maximumDevices: number;
  durationHours: number;
  managedProviderId: string;
};

export function AdminCloud() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState(() => sessionStorage.getItem('novacast-admin-token') ?? '');
  const [tab, setTab] = useState<AdminTab>(() => window.location.pathname === '/admin/diagnostics' ? 'analytics' : 'dashboard');
  const [devices, setDevices] = useState<Row[]>([]);
  const [invitations, setInvitations] = useState<Row[]>([]);
  const [providers, setProviders] = useState<Row[]>([]);
  const [dashboard, setDashboard] = useState<Row | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [openCreateInvite, setOpenCreateInvite] = useState(false);
  const [openAddProvider, setOpenAddProvider] = useState(false);

  const load = useCallback(async (nextToken: string, quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);

    try {
      const [deviceResult, inviteResult, providerResult, dashboardResult] = await Promise.all([
        adminRequest('admin-devices', nextToken),
        adminRequest('admin-invites', nextToken),
        adminRequest('admin-providers', nextToken).catch(() => ({ providers: [] })),
        adminRequest('admin-dashboard', nextToken).catch(() => null),
      ]);

      setDevices(Array.isArray(deviceResult.devices) ? deviceResult.devices : []);
      setInvitations(Array.isArray(inviteResult.invitations) ? inviteResult.invitations : []);
      setProviders(Array.isArray(providerResult.providers) ? providerResult.providers : []);
      setDashboard(dashboardResult);
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

  useEffect(() => {
    if (token && tab !== 'analytics') void load(token);
  }, [load, tab, token]);

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
    setInvitations([]);
    setProviders([]);
    setDashboard(null);
  };

  const extend = async (id: string, hours: number) => {
    try {
      await adminRequest('admin-device-action', token, {
        method: 'POST',
        body: JSON.stringify({ deviceId: id, action: 'extend', hours }),
      });
      setMessage('Beta access extended successfully.');
      await load(token, true);
    } catch (error) {
      const category = error instanceof Error ? error.message : 'admin_update_failed';
      setMessage('Beta access could not be extended (' + category + ').');
    }
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
          <p>Manage devices, beta access, invitations, providers, and platform activity.</p>
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

        <nav>
          <NavButton active={tab === 'dashboard'} icon="D" label="Dashboard" onClick={() => setTab('dashboard')} />
          <NavButton active={tab === 'devices'} icon="V" label="Devices" onClick={() => setTab('devices')} />
          <NavButton active={tab === 'providers'} icon="P" label="Providers" onClick={() => setTab('providers')} />
          <NavButton active={tab === 'gold'} icon="G" label="Gold Panel" onClick={() => setTab('gold')} />
          <NavButton active={tab === 'invitations'} icon="I" label="Invitations" onClick={() => setTab('invitations')} />
          <NavButton active={tab === 'analytics'} icon="A" label="Analytics" onClick={() => setTab('analytics')} />
          <NavButton active={tab === 'settings'} icon="S" label="Settings" onClick={() => setTab('settings')} />
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
            <button onClick={() => { if (tab !== 'analytics') void load(token, true); }} disabled={refreshing || tab === 'analytics'}>
              {refreshing ? 'Refreshing' : ' Refresh'}
            </button>
            <button className="cloudPrimary" onClick={() => { setTab('invitations'); setOpenCreateInvite(true); }}>
               New invitation
            </button>
          </div>
        </header>

        {message ? (
          <div className="cloudAdminNotice">
            <span>{message}</span>
            <button onClick={() => setMessage('')}></button>
          </div>
        ) : null}

        {loading ? <div className="cloudLoading">Loading NovaCast Cloud Admin</div> : null}

        {!loading && tab === 'dashboard' ? (
          <AdminDashboard
            data={dashboard}
            devices={devices}
            invitations={invitations}
            providers={providers}
            onNavigate={(next) => setTab(next)}
            onAddProvider={() => { setTab('providers'); setOpenAddProvider(true); }}
            onRefresh={() => void load(token, true)}
            refreshing={refreshing}
            onCreateInvite={() => { setTab('invitations'); setOpenCreateInvite(true); }}
          />
        ) : null}

        {!loading && tab === 'devices' ? (
          <AdminDevices
            devices={devices}
            providers={providers}
            onExtend={(id, hours) => void extend(id, hours)}
            onAssignProvider={(id, managedProviderId) => void assignProvider(id, managedProviderId)}
            onCommand={(id) => void command(id)}
            onRevoke={(id) => void revoke(id)}
            onMessage={setMessage}
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
            onRefresh={() => load(token, true)}
            onMessage={setMessage}
            openCreate={openAddProvider}
            onOpenCreateHandled={() => setOpenAddProvider(false)}
          />
        ) : null}
        {!loading && tab === 'analytics' ? (
          <AdminDiagnostics token={token} onMessage={setMessage} />
        ) : null}
        {!loading && tab === 'gold' ? <AdminGoldPanel token={token} devices={devices} providers={providers} onAssignProvider={(id, providerId) => void assignProvider(id, providerId)} onMessage={setMessage} /> : null}
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
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className={active ? 'active' : ''} onClick={onClick}>
      <span>{icon}</span>
      {label}
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
    dashboard: 'Dashboard',
    devices: 'Devices',
    providers: 'Providers',
    gold: 'Gold Panel',
    invitations: 'Invitations',
    analytics: 'Analytics',
    settings: 'Settings',
  }[tab];
}

function subtitleFor(tab: AdminTab) {
  return {
    dashboard: 'Monitor the NovaCast beta and manage platform operations.',
    devices: 'Manage and monitor all registered NovaCast devices.',
    providers: 'Add, validate, and activate managed IPTV providers before testers see them.',
    gold: 'Provision and monitor Gold reseller accounts linked to NovaCast providers.',
    invitations: 'Create and track controlled beta access.',
    analytics: 'Review device and playback performance.',
    settings: 'Configure NovaCast Cloud Admin.',
  }[tab];
}
