import { FormEvent, useMemo, useState } from 'react';
import { activateDevice, adminLogin, adminRequest, failureMessage, isPairingWebConfigured, normalizeCode, pairingWebConfigError, submitPairing, type ProviderInput } from './pairing';
import logoAsset from '../../assets/images/novacast-logo.png';

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
    if (code.length !== 8) return setError('Enter the 8-character code shown on your NovaCast TV.');
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
    return <main className="shell"><section className="card success"><Brand /><div className="successIcon" aria-hidden="true">✓</div><p className="eyebrow">DEVICE AUTHORIZATION COMPLETE</p><h1>Provider connected</h1><p>Authorization was sent to your NovaCast device. Return to the TV; it should open Home within a few seconds.</p><button onClick={() => window.location.reload()}>Pair another device</button></section></main>;
  }

  const configError = pairingWebConfigError();
  if (!isPairingWebConfigured()) {
    return <main className="shell"><section className="card"><Brand /><p className="eyebrow">NOVACAST DEVICE PAIRING</p><h1>Pairing site not configured</h1><p className="lede">{configError} Redeploy the Netlify site with the Supabase function URL and anon key.</p></section></main>;
  }

  return <main className="shell"><section className="card"><Brand /><p className="eyebrow">NOVACAST DEVICE PAIRING</p><h1>Connect your provider</h1><p className="lede">Enter the code shown on your TV, then add the provider you want NovaCast to use.</p><form onSubmit={submit} noValidate>
    <label>TV pairing code<input autoFocus value={code} onChange={(event) => setCode(normalizeCode(event.target.value))} inputMode="text" autoComplete="one-time-code" aria-describedby="code-help" /></label><small id="code-help">Codes expire after 10 minutes and can only be used once.</small>
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
  const [devices, setDevices] = useState<Record<string, unknown>[]>([]);
  const [invitations, setInvitations] = useState<Record<string, unknown>[]>([]);
  const [label, setLabel] = useState('');
  const [maximumDevices, setMaximumDevices] = useState('1');
  const [message, setMessage] = useState('');
  const signedIn = Boolean(token);
  const load = async (nextToken: string) => {
    const [deviceResult, inviteResult] = await Promise.all([adminRequest('admin-devices', nextToken), adminRequest('admin-invites', nextToken)]);
    setDevices(deviceResult.devices ?? []); setInvitations(inviteResult.invitations ?? []);
  };
  const login = async (event: FormEvent) => { event.preventDefault(); setMessage(''); try { const nextToken = await adminLogin(email, password); setToken(nextToken); await load(nextToken); } catch { setMessage('Administrator sign-in failed.'); } };
  const createInvite = async (event: FormEvent) => { event.preventDefault(); try { const result = await adminRequest('admin-invites', token, { method: 'POST', body: JSON.stringify({ label, maximumDevices: Number(maximumDevices) }) }); setMessage(`New invitation code: ${result.code}`); setLabel(''); await load(token); } catch { setMessage('Could not create invitation.'); } };
  const revoke = async (id: string) => { await adminRequest('admin-device-action', token, { method: 'POST', body: JSON.stringify({ deviceId: id, action: 'revoke' }) }); await load(token); };
  if (!signedIn) return <main className="shell"><section className="card"><Brand /><p className="eyebrow">NOVACAST ADMIN</p><h1>Administrator sign in</h1><form onSubmit={login}><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>{message ? <div role="alert" className="error">{message}</div> : null}<button className="submit">Sign in</button></form></section></main>;
  return <main className="shell adminShell"><section className="card adminCard"><Brand /><div className="adminHeader"><div><p className="eyebrow">NOVACAST ADMIN</p><h1>Device management</h1></div><button onClick={() => setToken('')}>Sign out</button></div>{message ? <div className="successNotice">{message}</div> : null}<div className="adminGrid"><div><h2>Devices</h2>{devices.map((device) => <div className="adminRow" key={String(device.id)}><div><strong>{String(device.public_device_code)}</strong><small>{String(device.friendly_name || device.model || 'NovaCast device')} · {String(device.activation_status)}</small></div><button className="dangerButton" onClick={() => void revoke(String(device.id))}>Revoke</button></div>)}{!devices.length ? <p className="privacy">No registered devices.</p> : null}</div><div><h2>Invitations</h2><form onSubmit={createInvite}><label>Label<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Beta tester" /></label><label>Maximum devices<input type="number" min="1" value={maximumDevices} onChange={(event) => setMaximumDevices(event.target.value)} /></label><button className="submit">Create invitation</button></form>{invitations.map((invite) => <div className="adminRow" key={String(invite.id)}><div><strong>{String(invite.display_label || 'Invitation')}</strong><small>{String(invite.status)} · {String(invite.redeemed_count)} / {String(invite.maximum_devices)}</small></div></div>)}</div></div></section></main>;
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
  if (state === 'success') return <main className="shell"><section className="card success"><Brand /><div className="successIcon" aria-hidden="true">✓</div><p className="eyebrow">ACTIVATION COMPLETE</p><h1>NovaCast activated</h1><p>Your TV can now check its beta access. Return to the device to continue.</p><button onClick={() => window.location.href = '/pair'}>Continue to pairing</button></section></main>;
  return <main className="shell"><section className="card"><Brand /><p className="eyebrow">NOVACAST DEVICE ACTIVATION</p><h1>Activate NovaCast</h1><p className="lede">Enter the Device ID shown on your TV and the invitation code provided to you.</p><form onSubmit={submit} noValidate>
    <label>Device ID<input autoFocus value={deviceId} onChange={(event) => setDeviceId(event.target.value.toUpperCase())} placeholder="NC-A7F4-29KD" autoComplete="off" /></label>
    <label>Invitation code<input value={invitationCode} onChange={(event) => setInvitationCode(event.target.value.toUpperCase())} autoComplete="one-time-code" /></label>
    <label>Device nickname <span className="optional">(optional)</span><input value={friendlyName} onChange={(event) => setFriendlyName(event.target.value.slice(0, 80))} placeholder="Living Room TV" autoComplete="off" /></label>
    {error ? <div role="alert" className="error">{error}</div> : null}
    <button className="submit" disabled={state === 'submitting'}>{state === 'submitting' ? 'Activating device...' : 'Activate device'}</button>
  </form></section></main>;
}

function Brand() {
  return <div className="brand"><img src={logoAsset} alt="NovaCast" /><div><span>NOVACAST</span><small>DEVICE PAIRING</small></div></div>;
}
