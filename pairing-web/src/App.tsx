import { AdminCloud } from './AdminCloud';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  activateDevice,
  failureMessage,
  isPairingWebConfigured,
  normalizeCode,
  pairingWebConfigError,
  submitPairing,
  type ProviderInput,
} from './pairing';
import { applyLegacyPairingRedirect, resolveAppRoute } from './routing';
import {
  APK_DOWNLOAD_PATH,
  DOWNLOADER_CODE,
  getPublicDownloadUrl,
  LATEST_STABLE_LABEL,
} from './siteConfig';

type ViewState = 'form' | 'submitting' | 'success' | 'error';

const emptyProvider: ProviderInput = { name: '', baseUrl: '', username: '', password: '' };

export function App() {
  const [routeTick, setRouteTick] = useState(0);

  useEffect(() => {
    if (
      applyLegacyPairingRedirect({
        pathname: window.location.pathname,
        search: window.location.search,
      })
    ) {
      return;
    }

    const onPopState = () => setRouteTick((value) => value + 1);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  void routeTick;
  const route = resolveAppRoute(window.location.pathname);

  if (route === 'activate') return <ActivationPage />;
  if (route === 'admin') return <AdminCloud />;
  if (route === 'download') return <DownloadPage />;
  if (route === 'pair') return <PairingPage />;
  return <HomePage />;
}

function navigate(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

function HomePage() {
  return (
    <main className="shell homeShell">
      <section className="card homeCard">
        <Brand subtitle="CONNECT" />
        <p className="eyebrow">OFFICIAL NOVACAST HUB</p>
        <h1>NovaCast Connect</h1>
        <p className="lede">
          The official location for downloading NovaCast, activating devices, and
          pairing your TV provider. Built for Android TV and Fire TV browsers.
        </p>

        <div className="homeNavGrid" role="navigation" aria-label="NovaCast Connect">
          <a className="homeNavCard" href="/download">
            <span className="homeNavLabel">Get the app</span>
            <strong>Download NovaCast</strong>
            <small>Latest Android TV APK and Downloader code</small>
          </a>
          <a className="homeNavCard" href="/activate">
            <span className="homeNavLabel">First-time setup</span>
            <strong>Activate Device</strong>
            <small>Enter your Device ID and invitation code</small>
          </a>
          <a className="homeNavCard" href="/pair">
            <span className="homeNavLabel">Provider access</span>
            <strong>Pair Provider</strong>
            <small>Connect the IPTV provider shown on your TV</small>
          </a>
          <a className="homeNavCard" href="/admin">
            <span className="homeNavLabel">Operators</span>
            <strong>Administration</strong>
            <small>Manage devices, invitations, and cloud access</small>
          </a>
        </div>
      </section>
    </main>
  );
}

function DownloadPage() {
  const publicUrl = getPublicDownloadUrl();

  return (
    <main className="shell">
      <section className="card downloadCard">
        <Brand subtitle="DOWNLOAD" />
        <p className="eyebrow">ANDROID TV RELEASE</p>
        <h1>Download NovaCast</h1>
        <p className="lede">
          Install the latest stable NovaCast build on Android TV or Fire TV, then
          activate your device and pair your provider.
        </p>

        <div className="downloadBadge">{LATEST_STABLE_LABEL}</div>

        <a className="submit downloadButton" href={APK_DOWNLOAD_PATH}>
          Download Latest APK
        </a>

        <div className="downloadMeta">
          <div className="downloadMetaBlock">
            <span>Downloader code</span>
            <strong className="downloaderCode">{DOWNLOADER_CODE}</strong>
          </div>
          <div className="downloadMetaBlock">
            <span>Direct installation URL</span>
            <strong className="downloadUrlText">{publicUrl.replace(/^https?:\/\//, '')}</strong>
          </div>
        </div>

        <div className="rule" />

        <h2 className="downloadSectionTitle">Install with Downloader</h2>
        <ol className="downloadSteps">
          <li>Open the Downloader app.</li>
          <li>
            Enter code <code>{DOWNLOADER_CODE}</code>.
          </li>
          <li>Download the NovaCast APK.</li>
          <li>Allow installation from unknown sources when requested.</li>
          <li>Install and open NovaCast.</li>
          <li>Activate the device and pair the provider.</li>
        </ol>

        <p className="downloadNote">
          Compatible with Android TV and Fire TV devices that allow sideloading.
        </p>
        <p className="downloadWarning" role="note">
          Only download NovaCast from this official Connect site or the linked
          GitHub Release. Never install APKs from unofficial mirrors.
        </p>

        <div className="downloadLinks">
          <a href="/activate">Activate device</a>
          <a href="/pair">Pair provider</a>
          <a href="/">Back to Connect home</a>
        </div>
      </section>
    </main>
  );
}

function PairingPage() {
  const initialCode = useMemo(
    () => normalizeCode(new URLSearchParams(window.location.search).get('code') ?? ''),
    []
  );
  const [code, setCode] = useState(initialCode);
  const [provider, setProvider] = useState(emptyProvider);
  const [showPassword, setShowPassword] = useState(false);
  const [state, setState] = useState<ViewState>('form');
  const [error, setError] = useState('');

  const updateProvider = (field: keyof ProviderInput, value: string) =>
    setProvider((current) => ({ ...current, [field]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (code.length !== 8) return setError('Enter the 8-character code shown on your NovaCast TV.');
    if (!provider.name.trim() || !provider.baseUrl.trim() || !provider.username.trim() || !provider.password) {
      return setError('Complete every provider field before continuing.');
    }
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
    return (
      <main className="shell">
        <section className="card success">
          <Brand subtitle="DEVICE PAIRING" />
          <div className="successIcon" aria-hidden="true"></div>
          <p className="eyebrow">DEVICE AUTHORIZATION COMPLETE</p>
          <h1>Provider connected</h1>
          <p>Authorization was sent to your NovaCast device. Return to the TV; it should open Home within a few seconds.</p>
          <button type="button" onClick={() => window.location.reload()}>
            Pair another device
          </button>
        </section>
      </main>
    );
  }

  const configError = pairingWebConfigError();
  if (!isPairingWebConfigured()) {
    return (
      <main className="shell">
        <section className="card">
          <Brand subtitle="DEVICE PAIRING" />
          <p className="eyebrow">NOVACAST DEVICE PAIRING</p>
          <h1>Pairing site not configured</h1>
          <p className="lede">
            {configError} Redeploy the Netlify site with the Supabase function URL and anon key.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <section className="card">
        <Brand subtitle="DEVICE PAIRING" />
        <p className="eyebrow">NOVACAST DEVICE PAIRING</p>
        <h1>Connect your provider</h1>
        <p className="lede">Enter the code shown on your TV, then add the provider you want NovaCast to use.</p>
        <form onSubmit={submit} noValidate>
          <label>
            TV pairing code
            <input
              autoFocus
              value={code}
              onChange={(event) => setCode(normalizeCode(event.target.value))}
              inputMode="text"
              autoComplete="one-time-code"
              aria-describedby="code-help"
            />
          </label>
          <small id="code-help">Codes expire after 10 minutes and can only be used once.</small>
          <div className="rule" />
          <label>
            Provider name
            <input
              value={provider.name}
              onChange={(event) => updateProvider('name', event.target.value)}
              autoComplete="organization"
            />
          </label>
          <label>
            Server URL
            <input
              value={provider.baseUrl}
              onChange={(event) => updateProvider('baseUrl', event.target.value)}
              placeholder="https://provider.example"
              autoComplete="url"
            />
          </label>
          <label>
            Username
            <input
              value={provider.username}
              onChange={(event) => updateProvider('username', event.target.value)}
              autoComplete="username"
            />
          </label>
          <label>
            Password
            <div className="passwordField">
              <input
                type={showPassword ? 'text' : 'password'}
                value={provider.password}
                onChange={(event) => updateProvider('password', event.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                className="showButton"
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
          {error ? (
            <div role="alert" className="error">
              {error}
            </div>
          ) : null}
          <button className="submit" disabled={state === 'submitting'} type="submit">
            {state === 'submitting' ? 'Validating provider...' : 'Connect provider'}
          </button>
        </form>
        <p className="privacy">
          Credentials are sent to the NovaCast validation service over HTTPS and are not stored in this browser.
        </p>
        <div className="downloadLinks">
          <a href="/">Connect home</a>
          <a href="/download">Download NovaCast</a>
          <a href="/activate">Activate device</a>
        </div>
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
    if (!/^NC-[A-Z2-9]{4}-[A-Z2-9]{4}$/i.test(deviceId.trim())) {
      return setError('Enter the Device ID shown on your NovaCast TV.');
    }
    if (!invitationCode.trim()) return setError('Enter your NovaCast invitation code.');
    setState('submitting');
    try {
      await activateDevice(deviceId, invitationCode, friendlyName);
      setState('success');
    } catch (submissionError) {
      setError(
        failureMessage(submissionError instanceof Error ? submissionError.message : 'activation_unavailable')
      );
      setState('error');
    }
  };

  if (state === 'success') {
    return (
      <main className="shell">
        <section className="card success">
          <Brand subtitle="ACTIVATION" />
          <div className="successIcon" aria-hidden="true"></div>
          <p className="eyebrow">ACTIVATION COMPLETE</p>
          <h1>NovaCast activated</h1>
          <p>Your TV can now check its beta access. Return to the device to continue.</p>
          <button type="button" onClick={() => navigate('/pair')}>
            Continue to pairing
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <section className="card">
        <Brand subtitle="ACTIVATION" />
        <p className="eyebrow">NOVACAST DEVICE ACTIVATION</p>
        <h1>Activate NovaCast</h1>
        <p className="lede">Enter the Device ID shown on your TV and the invitation code provided to you.</p>
        <form onSubmit={submit} noValidate>
          <label>
            Device ID
            <input
              autoFocus
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value.toUpperCase())}
              placeholder="NC-A7F4-29KD"
              autoComplete="off"
            />
          </label>
          <label>
            Invitation code
            <input
              value={invitationCode}
              onChange={(event) => setInvitationCode(event.target.value.toUpperCase())}
              autoComplete="one-time-code"
            />
          </label>
          <label>
            Device nickname <span className="optional">(optional)</span>
            <input
              value={friendlyName}
              onChange={(event) => setFriendlyName(event.target.value.slice(0, 80))}
              placeholder="Living Room TV"
              autoComplete="off"
            />
          </label>
          {error ? (
            <div role="alert" className="error">
              {error}
            </div>
          ) : null}
          <button className="submit" disabled={state === 'submitting'} type="submit">
            {state === 'submitting' ? 'Activating device...' : 'Activate device'}
          </button>
        </form>
        <div className="downloadLinks">
          <a href="/">Connect home</a>
          <a href="/download">Download NovaCast</a>
          <a href="/pair">Pair provider</a>
        </div>
      </section>
    </main>
  );
}

function Brand({ subtitle = 'DEVICE PAIRING' }: { subtitle?: string }) {
  return (
    <div className="brand">
      <img src="/novacast-logo.png" alt="NovaCast" />
      <div>
        <span>NOVACAST</span>
        <small>{subtitle}</small>
      </div>
    </div>
  );
}
