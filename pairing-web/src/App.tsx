import { FormEvent, useMemo, useState } from 'react';
import { activateDevice, adminLogin, adminRequest, failureMessage, isPairingWebConfigured, normalizeCode, pairingWebConfigError, submitPairing, type ProviderInput } from './pairing';
import { AdminDashboard } from './AdminDashboard';
import { AdminDevices } from './AdminDevices';
import { AdminInvitations } from './AdminInvitations';

type ViewState = 'form' | 'submitting' | 'success' | 'error';

const emptyProvider: ProviderInput = { name: '', baseUrl: '', username: '', password: '' };

export function App() {
  if (window.location.pathname === '/activate') return <ActivationPage />;
  if (window.location.pathname.startsWith('/admin')) return <AdminPage />;
  const initialCode = useMemo(() => normalizeCode(new URLSearchParams(window.location.search).get('code') ?? ''), []);
  const [code, setCode] = useState(initialCode);
  const [provider, setProvider] = useState(emptyProvider);
  const [showPassword, setShowPassword] = useState(false);
  const [state, setState] = useState<ViewState>('form');
  const [error, setError] = useState('');

  const updateProvider = (field: keyof ProviderInput, value: string) => setProvider((current) => ({ ...current, [field]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (code.length !== 8) return setError('Enter the 8-character pairing code shown on your NovaCast TV.');
    if (!provider.name.trim() || !provider.baseUrl.trim() || !provider.username.trim() || !provider.password) return setError('Complete every provider field before continuing.');
    setState('submitting');
    try {
      await submitPairing(code, provider);
      setState('success');
    } catch (submissionError) {
      setError(failureMessage(submissionError instanceof Error ? submissionError.message : 'unexpected_server_error'));
      setState('error');
    }
  };

  if (state === 'success') {
    return <main className="shell"><section className="card success"><Brand /><div className="successIcon" aria-hidden="true"><svg viewBox="0 0 24 24" role="presentation"><path d="m5 12.5 4.2 4.2L19.5 6.5" /></svg></div><p className="eyebrow">DEVICE AUTHORIZATION COMPLETE</p><h1>Provider connected</h1><p>Authorization was sent to your NovaCast device. Return to the TV; it should open Home within a few seconds.</p><button onClick={() => window.location.reload()}>Pair another device</button></section></main>;
  }

  const configError = pairingWebConfigError();
  if (!isPairingWebConfigured()) {
    return <main className="shell"><section className="card"><Brand /><p className="eyebrow">NOVACAST DEVICE PAIRING</p><h1>Pairing site not configured</h1><p className="lede">{configError} Redeploy the Netlify site with the Supabase function URL and anon key.</p></section></main>;
  }

  return <main className="shell"><section className="card"><Brand /><p className="eyebrow">NOVACAST DEVICE PAIRING</p><h1>Connect your provider</h1><p className="lede">Enter the temporary pairing code shown on your TV, then add the provider NovaCast should use. The website talks to NovaCast through the backend — never directly to the TV.</p><form onSubmit={submit} noValidate>
    <label>TV pairing code<input autoFocus value={code} onChange={(event) => setCode(normalizeCode(event.target.value))} inputMode="text" autoComplete="one-time-code" aria-describedby="code-help" /></label><small id="code-help">Temporary code from the TV. Expires after 10 minutes and can only be used once.</small>
    <div className="rule" />
    <label>Provider name<input value={provider.name} onChange={(event) => updateProvider('name', event.target.value)} autoComplete="organization" /></label>
    <label>Server URL<input value={provider.baseUrl} onChange={(event) => updateProvider('baseUrl', event.target.value)} placeholder="https://provider.example" autoComplete="url" /></label>
    <label>Username<input value={provider.username} onChange={(event) => updateProvider('username', event.target.value)} autoComplete="username" /></label>
    <label>Password<div className="passwordField"><input type={showPassword ? 'text' : 'password'} value={provider.password} onChange={(event) => updateProvider('password', event.target.value)} autoComplete="current-password" /><button type="button" className="showButton" onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>
    {error ? <div role="alert" className="error">{error}</div> : null}
    <button className="submit" disabled={state === 'submitting'}>{state === 'submitting' ? 'Validating provider...' : 'Connect provider'}</button>
  </form><p className="privacy">Credentials are sent to the NovaCast validation service over HTTPS and are not stored in this browser.</p></section></main>;
}

function AdminPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState('');
  const [tab, setTab] = useState<'dashboard' | 'devices' | 'invitations' | 'providers'>('dashboard');
  const [devices, setDevices] = useState<Record<string, unknown>[]>([]);
  const [invitations, setInvitations] = useState<Record<string, unknown>[]>([]);
  const [providers, setProviders] = useState<Record<string, unknown>[]>([]);
  const [dashboard, setDashboard] = useState<Record<string, unknown> | null>(null);
  const [label, setLabel] = useState('');
  const [maximumDevices, setMaximumDevices] = useState('1');
  const [durationHours, setDurationHours] = useState('72');
  const [managedProviderId, setManagedProviderId] = useState('');
  const [providerName, setProviderName] = useState('');
  const [providerSlug, setProviderSlug] = useState('');
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [providerUsername, setProviderUsername] = useState('');
  const [providerPassword, setProviderPassword] = useState('');
  const [message, setMessage] = useState('');
  const [lastInviteCode, setLastInviteCode] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [newInvitationRequested, setNewInvitationRequested] = useState(false);
  const signedIn = Boolean(token);

  const load = async (nextToken: string) => {
    const [deviceResult, inviteResult, providerResult, dashboardResult] = await Promise.all([
      adminRequest('admin-devices', nextToken),
      adminRequest('admin-invites', nextToken),
      adminRequest('admin-providers', nextToken),
      adminRequest('admin-dashboard', nextToken),
    ]);
    setDevices(deviceResult.devices ?? []);
    setInvitations(inviteResult.invitations ?? []);
    setProviders(providerResult.providers ?? []);
    setDashboard(dashboardResult.dashboard ?? null);
  };

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    try {
      const nextToken = await adminLogin(email, password);
      try {
        await load(nextToken);
        setToken(nextToken);
      } catch (loadError) {
        const detail = loadError instanceof Error ? loadError.message : 'admin_request_failed';
        if (detail === 'admin_unauthorized') {
          setMessage('Signed in, but this account is not an admin. Set app_metadata.role to "admin" in Supabase Auth.');
        } else {
          setMessage(`Signed in, but admin APIs failed (${detail}). Check Edge Functions and VITE_PAIRING_API_URL.`);
        }
      }
    } catch (loginError) {
      const detail = loginError instanceof Error ? loginError.message : 'admin_login_failed';
      setMessage(
        detail === 'admin_login_failed'
          ? 'Administrator sign-in failed. Check email/password, and that this site’s VITE_SUPABASE_URL + anon key match your NovaCast project.'
          : `Administrator sign-in failed (${detail}).`,
      );
    }
  };

  const createInvite = async (input: { label: string; maximumDevices: number; durationHours: number; managedProviderId: string }) => {
    const result = await adminRequest('admin-invites', token, {
      method: 'POST',
      body: JSON.stringify({ ...input, activationDurationHours: input.durationHours, contentPolicy: 'us_only' }),
    });
    const code = typeof result.code === 'string' ? result.code : '';
    setMessage(code ? 'Invitation created. Copy the code below — it cannot be shown again.' : 'Invitation created.');
    await load(token);
    return code;
  };

  const copyLastInviteCode = async () => {
    if (!lastInviteCode) return;
    try {
      await navigator.clipboard.writeText(lastInviteCode);
      setMessage('Invitation code copied.');
    } catch {
      setMessage('Could not copy automatically — select the code and copy it manually.');
    }
  };

  const createProvider = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await adminRequest('admin-providers', token, {
        method: 'POST',
        body: JSON.stringify({
          slug: providerSlug,
          displayName: providerName,
          contentPolicy: 'us_only',
          credentials: { baseUrl: providerBaseUrl, username: providerUsername, password: providerPassword },
        }),
      });
      setMessage(`Provider "${providerName}" created.`);
      setProviderName('');
      setProviderSlug('');
      setProviderBaseUrl('');
      setProviderUsername('');
      setProviderPassword('');
      await load(token);
    } catch {
      setMessage('Could not create managed provider.');
    }
  };

  const revoke = async (id: string) => {
    await adminRequest('admin-device-action', token, { method: 'POST', body: JSON.stringify({ deviceId: id, action: 'revoke' }) });
    await load(token);
  };

  const extend = async (id: string, hours: number) => {
    await adminRequest('admin-device-action', token, {
      method: 'POST',
      body: JSON.stringify({ deviceId: id, action: 'extend', hours }),
    });
    setMessage(`Extended device access by ${hours} hours.`);
    await load(token);
  };

  const sendCommand = async (deviceId: string, command: string) => {
    await adminRequest('admin-commands', token, {
      method: 'POST',
      body: JSON.stringify({ deviceId, command }),
    });
    setMessage(`Queued command: ${command}`);
  };

  const refreshDashboard = async () => {
    if (refreshing || !token) return;
    setRefreshing(true);
    try {
      await load(token);
      setMessage('Dashboard refreshed.');
    } catch {
      setMessage('Could not refresh dashboard data.');
    } finally {
      setRefreshing(false);
    }
  };

  if (!signedIn) {
    return (
      <main className="shell">
        <section className="card">
          <Brand />
          <p className="eyebrow">NOVACAST ADMIN</p>
          <h1>Administrator sign in</h1>
          <form onSubmit={login}>
            <label>
              Email
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
            </label>
            <label>
              Password
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
            </label>
            {message ? <div role="alert" className="error">{message}</div> : null}
            <button className="submit">Sign in</button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="adminApp">
      <aside className="adminSidebar"><Brand /><p className="sidebarKicker">CLOUD ADMIN</p><nav aria-label="Admin navigation">{(['dashboard', 'devices', 'invitations', 'providers'] as const).map((item) => <button key={item} className={tab === item ? 'navActive' : ''} onClick={() => setTab(item)}><span>{item === 'dashboard' ? '⌂' : item === 'devices' ? '▣' : item === 'invitations' ? '✦' : '◈'}</span>{item}</button>)}<button disabled title="Coming soon"><span>◌</span>Activity log</button><button disabled title="Coming soon"><span>◒</span>Analytics</button><button disabled title="Coming soon"><span>⚙</span>Settings</button></nav><div className="adminProfile"><span className="profileAvatar">NC</span><div><strong>NovaCast Admin</strong><small>{email}</small></div><button aria-label="Sign out" onClick={() => setToken('')}>↪</button></div></aside>
      <section className="adminMain">
        <header className="dashboardHeader"><div><p className="eyebrow">NOVACAST CLOUD ADMIN</p><h1>{tab === 'devices' ? 'Devices' : tab === 'invitations' ? 'Invitations' : tab[0].toUpperCase() + tab.slice(1)}</h1><p>{tab === 'devices' ? 'Manage and monitor all beta devices' : tab === 'invitations' ? 'Create, manage, and monitor access to the NovaCast beta.' : 'Real-time overview of your closed beta program'}</p></div><div className="headerTools"><span className="liveStatus"><i /> Live</span><button aria-label="Refresh dashboard" onClick={() => void refreshDashboard()} disabled={refreshing}>{refreshing ? '↻' : '⟳'}</button><button aria-label="Notifications">♧</button>{tab === 'devices' ? <button className="addDeviceHeader" onClick={() => setMessage('Devices register themselves from the NovaCast TV. Use the TV pairing screen to add a device.')}>＋ Add device</button> : tab === 'invitations' ? <button className="addDeviceHeader" onClick={() => setNewInvitationRequested(true)}>＋ New invitation</button> : null}</div></header>
        <div className="adminTabs">
          {(['dashboard', 'devices', 'invitations', 'providers'] as const).map((item) => (
            <button key={item} className={tab === item ? 'tabActive' : ''} onClick={() => setTab(item)}>
              {item}
            </button>
          ))}
        </div>
        {message ? <div className="successNotice">{message}</div> : null}

        {tab === 'dashboard' ? <AdminDashboard data={dashboard as Record<string, unknown> | null} devices={devices} invitations={invitations} providers={providers} onNavigate={setTab} onRefresh={() => void refreshDashboard()} refreshing={refreshing} onCreateInvite={() => setTab('invitations')} /> : null}

        {tab === 'devices' ? <AdminDevices devices={devices} onExtend={(id, hours) => void extend(id, hours)} onCommand={(id) => void sendCommand(id, 'refresh_library')} onRevoke={(id) => void revoke(id)} onMessage={setMessage} /> : null}

        {tab === 'invitations' ? <AdminInvitations invitations={invitations} providers={providers} onCreate={createInvite} onMessage={setMessage} openCreate={newInvitationRequested} onOpenCreateHandled={() => setNewInvitationRequested(false)} /> : null}

        {tab === 'providers' ? (
          <div>
            <h2>Managed providers</h2>
            <form onSubmit={createProvider}>
              <label>
                Display name
                <input value={providerName} onChange={(event) => setProviderName(event.target.value)} />
              </label>
              <label>
                Slug
                <input value={providerSlug} onChange={(event) => setProviderSlug(event.target.value)} placeholder="beta-us" />
              </label>
              <label>
                Server URL
                <input value={providerBaseUrl} onChange={(event) => setProviderBaseUrl(event.target.value)} />
              </label>
              <label>
                Username
                <input value={providerUsername} onChange={(event) => setProviderUsername(event.target.value)} />
              </label>
              <label>
                Password
                <input type="password" value={providerPassword} onChange={(event) => setProviderPassword(event.target.value)} />
              </label>
              <button className="submit">Create provider package</button>
            </form>
            {providers.map((provider) => (
              <div className="adminRow" key={String(provider.id)}>
                <div>
                  <strong>{String(provider.display_name)}</strong>
                  <small>
                    {String(provider.slug)} · {String(provider.status)} · {String(provider.assignedDevices ?? 0)} devices ·{' '}
                    {String(provider.content_policy)}
                  </small>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function ActivationPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [deviceId, setDeviceId] = useState(params.get('device') ?? '');
  const [invitationCode, setInvitationCode] = useState(params.get('invite') ?? '');
  const [friendlyName, setFriendlyName] = useState('');
  const [state, setState] = useState<'form' | 'submitting' | 'success' | 'error'>('form');
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!/^NC-[A-Z2-9]{4}-[A-Z2-9]{4}$/i.test(deviceId.trim())) return setError('Enter the Device ID shown on your NovaCast TV.');
    if (!invitationCode.trim()) return setError('Enter your NovaCast invitation code.');
    setState('submitting');
    try { await activateDevice(deviceId, invitationCode, friendlyName); setState('success'); }
    catch (submissionError) { setError(failureMessage(submissionError instanceof Error ? submissionError.message : 'activation_unavailable')); setState('error'); }
  };
  if (state === 'success') return <main className="shell"><section className="card success"><Brand /><div className="successIcon" aria-hidden="true"><svg viewBox="0 0 24 24" role="presentation"><path d="m5 12.5 4.2 4.2L19.5 6.5" /></svg></div><p className="eyebrow">ACTIVATION COMPLETE</p><h1>NovaCast activated</h1><p>Return to the TV. NovaCast will download the assigned library and open Home automatically.</p></section></main>;
  return <main className="shell"><section className="card"><Brand /><p className="eyebrow">NOVACAST CLOSED BETA</p><h1>Activate NovaCast</h1><p className="lede">Enter the Device ID shown on your TV and the invitation code provided to you. No provider credentials are required.</p><form onSubmit={submit} noValidate>
    <label>Device ID<input autoFocus value={deviceId} onChange={(event) => setDeviceId(event.target.value.toUpperCase())} placeholder="NC-A7F4-29KD" autoComplete="off" /></label>
    <label>Invitation code<input value={invitationCode} onChange={(event) => setInvitationCode(event.target.value.toUpperCase())} autoComplete="one-time-code" /></label>
    <label>Device nickname <span className="optional">(optional)</span><input value={friendlyName} onChange={(event) => setFriendlyName(event.target.value.slice(0, 80))} placeholder="Living Room TV" autoComplete="off" /></label>
    {error ? <div role="alert" className="error">{error}</div> : null}
    <button className="submit" disabled={state === 'submitting'}>{state === 'submitting' ? 'Activating device...' : 'Activate device'}</button>
  </form></section></main>;
}

function Brand() {
  return <div className="brand"><img src="/novacast-logo.png" alt="NovaCast" /><div><span>NOVACAST</span><small>DEVICE PAIRING</small></div></div>;
}
