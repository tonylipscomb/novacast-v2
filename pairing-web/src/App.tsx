import { FormEvent, useMemo, useState } from 'react';
import { activateDevice, adminLogin, adminRequest, failureMessage, isPairingWebConfigured, normalizeCode, pairingWebConfigError, submitPairing, type ProviderInput } from './pairing';

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
      setToken(nextToken);
      await load(nextToken);
    } catch {
      setMessage('Administrator sign-in failed.');
    }
  };

  const createInvite = async (event: FormEvent) => {
    event.preventDefault();
    try {
      const result = await adminRequest('admin-invites', token, {
        method: 'POST',
        body: JSON.stringify({
          label,
          maximumDevices: Number(maximumDevices),
          activationDurationHours: Number(durationHours) || 72,
          managedProviderId: managedProviderId || undefined,
          contentPolicy: 'us_only',
        }),
      });
      setMessage(`New invitation code: ${result.code}`);
      setLabel('');
      await load(token);
    } catch {
      setMessage('Could not create invitation.');
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
    <main className="shell adminShell">
      <section className="card adminCard">
        <Brand />
        <div className="adminHeader">
          <div>
            <p className="eyebrow">NOVACAST CLOUD ADMIN</p>
            <h1>Closed beta control plane</h1>
          </div>
          <button onClick={() => setToken('')}>Sign out</button>
        </div>
        <div className="adminTabs">
          {(['dashboard', 'devices', 'invitations', 'providers'] as const).map((item) => (
            <button key={item} className={tab === item ? 'tabActive' : ''} onClick={() => setTab(item)}>
              {item}
            </button>
          ))}
        </div>
        {message ? <div className="successNotice">{message}</div> : null}

        {tab === 'dashboard' ? (
          <div className="adminStats">
            {[
              ['Online', dashboard?.devicesOnline],
              ['Offline', dashboard?.devicesOffline],
              ['Activated', dashboard?.activatedDevices],
              ['Expired', dashboard?.expiredDevices],
              ['Pending', dashboard?.pendingActivations],
              ['Providers', dashboard?.providers],
              ['Invites', dashboard?.activeInvitations],
              ['Command queue', dashboard?.syncQueue],
            ].map(([labelText, value]) => (
              <div className="adminStat" key={String(labelText)}>
                <strong>{String(value ?? 0)}</strong>
                <span>{String(labelText ?? '')}</span>
              </div>
            ))}
            <p className="privacy">Current beta build: {String(dashboard?.currentBetaBuild ?? 'unknown')}</p>
          </div>
        ) : null}

        {tab === 'devices' ? (
          <div>
            <h2>Devices</h2>
            {devices.map((device) => (
              <div className="adminRow" key={String(device.id)}>
                <div>
                  <strong>{String(device.public_device_code)}</strong>
                  <small>
                    {String(device.assigned_tester_name || device.friendly_name || device.model || 'NovaCast device')} ·{' '}
                    {String(device.activation_status)} · {String(device.content_policy || 'us_only')} ·{' '}
                    {String(device.app_version || 'n/a')}
                  </small>
                </div>
                <div className="adminRowActions">
                  <button onClick={() => void extend(String(device.id), 24)}>+24h</button>
                  <button onClick={() => void extend(String(device.id), 72)}>+72h</button>
                  <button onClick={() => void extend(String(device.id), 168)}>+7d</button>
                  <button onClick={() => void sendCommand(String(device.id), 'refresh_library')}>Refresh</button>
                  <button onClick={() => void sendCommand(String(device.id), 'run_diagnostics')}>Diagnostics</button>
                  <button className="dangerButton" onClick={() => void revoke(String(device.id))}>
                    Revoke
                  </button>
                </div>
              </div>
            ))}
            {!devices.length ? <p className="privacy">No registered devices.</p> : null}
          </div>
        ) : null}

        {tab === 'invitations' ? (
          <div>
            <h2>Invitations</h2>
            <form onSubmit={createInvite}>
              <label>
                Label
                <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Beta tester" />
              </label>
              <label>
                Maximum devices
                <input type="number" min="1" value={maximumDevices} onChange={(event) => setMaximumDevices(event.target.value)} />
              </label>
              <label>
                Duration hours
                <input type="number" min="1" value={durationHours} onChange={(event) => setDurationHours(event.target.value)} />
              </label>
              <label>
                Managed provider
                <select value={managedProviderId} onChange={(event) => setManagedProviderId(event.target.value)}>
                  <option value="">None</option>
                  {providers.map((provider) => (
                    <option key={String(provider.id)} value={String(provider.id)}>
                      {String(provider.display_name)}
                    </option>
                  ))}
                </select>
              </label>
              <button className="submit">Create invitation</button>
            </form>
            {invitations.map((invite) => (
              <div className="adminRow" key={String(invite.id)}>
                <div>
                  <strong>{String(invite.display_label || 'Invitation')}</strong>
                  <small>
                    {String(invite.status)} · {String(invite.redeemed_count)} / {String(invite.maximum_devices)} ·{' '}
                    {String(invite.activation_duration_hours || '—')}h · {String(invite.content_policy || 'us_only')}
                  </small>
                </div>
              </div>
            ))}
          </div>
        ) : null}

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
