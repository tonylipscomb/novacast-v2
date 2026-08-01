import { useMemo, useState } from 'react';

type Device = Record<string, unknown>;
type Provider = Record<string, unknown>;
type Action = (id: string) => void;
type ExtendAction = (id: string, hours: number) => void;
type AssignProviderAction = (id: string, managedProviderId: string) => void;

type ExtendPreset = '7' | '30' | '90' | 'custom' | 'never';

export function AdminDevices({
  devices,
  providers,
  onExtend,
  onAssignProvider,
  onCommand,
  onRevoke,
  onMessage,
}: {
  devices: Device[];
  providers: Provider[];
  onExtend: ExtendAction;
  onAssignProvider: AssignProviderAction;
  onCommand: Action;
  onRevoke: Action;
  onMessage: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [platform, setPlatform] = useState('all');
  const [beta, setBeta] = useState('all');
  const [page, setPage] = useState(1);
  const [extendDevice, setExtendDevice] = useState<Device | null>(null);
  const [extendPreset, setExtendPreset] = useState<ExtendPreset>('30');
  const [customDate, setCustomDate] = useState('');
  const [providerDevice, setProviderDevice] = useState<Device | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const pageSize = 10;

  const providerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const provider of providers) {
      const id = String(provider.id ?? '');
      if (!id) continue;
      map.set(id, String(provider.display_name ?? provider.slug ?? 'Managed provider'));
    }
    return map;
  }, [providers]);

  const activeProviders = useMemo(
    () => providers.filter((provider) => String(provider.status ?? 'active') === 'active'),
    [providers],
  );

  const filtered = useMemo(
    () =>
      devices.filter((device) => {
        const haystack = [
          device.public_device_code,
          device.friendly_name,
          device.model,
          device.platform,
          device.assigned_tester_name,
        ]
          .map(String)
          .join(' ')
          .toLowerCase();
        const activation = String(device.activation_status ?? 'inactive');
        return (
          (!query.trim() || haystack.includes(query.trim().toLowerCase())) &&
          (status === 'all' ||
            String(device.status ?? '') === status ||
            (status === 'online' && isOnline(device))) &&
          (platform === 'all' || String(device.platform ?? '') === platform) &&
          (beta === 'all' || activation === beta)
        );
      }),
    [devices, query, status, platform, beta],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  const counts = {
    total: devices.length,
    online: devices.filter(isOnline).length,
    active: devices.filter((device) => device.activation_status === 'active').length,
    expired: devices.filter((device) => device.activation_status === 'expired').length,
    offline: devices.filter((device) => !isOnline(device)).length,
    errors: devices.filter((device) => Boolean(device.last_diagnostics)).length,
  };
  const platforms = [...new Set(devices.map((device) => String(device.platform ?? '')).filter(Boolean))];

  const clear = () => {
    setQuery('');
    setStatus('all');
    setPlatform('all');
    setBeta('all');
    setPage(1);
  };

  const exportDevices = () => {
    const safe = filtered.map(
      ({
        id,
        public_device_code,
        friendly_name,
        platform,
        manufacturer,
        model,
        os_version,
        app_version,
        app_build,
        status: deviceStatus,
        activation_status,
        activation_expires_at,
        last_seen_at,
        created_at,
        content_policy,
      }) => ({
        id,
        public_device_code,
        friendly_name,
        platform,
        manufacturer,
        model,
        os_version,
        app_version,
        app_build,
        status: deviceStatus,
        activation_status,
        activation_expires_at,
        last_seen_at,
        created_at,
        content_policy,
      }),
    );
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), devices: safe }, null, 2)],
      { type: 'application/json' },
    );
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `novacast-devices-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const openExtend = (device: Device) => {
    setExtendDevice(device);
    setExtendPreset('30');
    setCustomDate('');
  };

  const openChangeProvider = (device: Device) => {
    const currentId = String(device.managed_provider_id ?? '');
    const fallback = activeProviders[0] ? String(activeProviders[0].id) : '';
    setProviderDevice(device);
    setSelectedProviderId(currentId || fallback);
  };

  const saveProviderChange = () => {
    if (!providerDevice) return;
    if (!selectedProviderId) {
      onMessage('Choose a managed provider for this device.');
      return;
    }
    onAssignProvider(String(providerDevice.id), selectedProviderId);
    setProviderDevice(null);
  };

  const saveExtension = () => {
    if (!extendDevice) return;
    const id = String(extendDevice.id);
    let hours = 0;

    if (extendPreset === 'never') {
      // Uses a 100-year access window while preserving the existing timestamp schema.
      hours = 24 * 365 * 100;
    } else if (extendPreset === 'custom') {
      const target = Date.parse(customDate);
      if (!Number.isFinite(target) || target <= Date.now()) {
        onMessage('Choose a future expiration date.');
        return;
      }
      hours = Math.max(1, Math.ceil((target - Date.now()) / 3600000));
    } else {
      hours = Number(extendPreset) * 24;
    }

    onExtend(id, hours);
    setExtendDevice(null);
  };

  return (
    <div className="devicesPage">
      <div className="deviceMetricGrid">
        <DeviceMetric label="Total devices" value={counts.total} tone="blue" icon="" />
        <DeviceMetric label="Online" value={counts.online} tone="green" icon="" />
        <DeviceMetric label="Active (beta)" value={counts.active} tone="purple" icon="" />
        <DeviceMetric label="Expired" value={counts.expired} tone="amber" icon="" />
        <DeviceMetric label="Offline" value={counts.offline} tone="slate" icon="" />
        <DeviceMetric label="Errors" value={counts.errors} tone="red" icon="!" />
      </div>

      <section className="deviceFilters">
        <label className="deviceSearch">
          <span></span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search devices by name, ID, model, or platform"
          />
        </label>
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by status">
          <option value="all">All statuses</option>
          <option value="online">Online</option>
          <option value="active">Active</option>
          <option value="registered">Registered</option>
          <option value="revoked">Revoked</option>
        </select>
        <select
          value={platform}
          onChange={(event) => {
            setPlatform(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by platform">
          <option value="all">All platforms</option>
          {platforms.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          value={beta}
          onChange={(event) => {
            setBeta(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by beta status">
          <option value="all">All beta statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Pending</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </select>
        <button className="filterButton" onClick={clear}>
          Clear filters
        </button>
        <button className="exportButton" onClick={exportDevices}>
           Export
        </button>
      </section>

      <section className="deviceTablePanel">
        <div className="deviceTableHead">
          <span>Device</span>
          <span>Status</span>
          <span>Beta status</span>
          <span>Last seen</span>
          <span>Platform</span>
          <span>Model</span>
          <span>App version</span>
          <span>Actions</span>
        </div>
        {visible.length ? (
          visible.map((device) => (
            <DeviceRow
              key={String(device.id)}
              device={device}
              providerName={
                providerNameById.get(String(device.managed_provider_id ?? '')) ?? 'No provider'
              }
              onExtend={() => openExtend(device)}
              onChangeProvider={() => openChangeProvider(device)}
              onCommand={onCommand}
              onRevoke={onRevoke}
              onMessage={onMessage}
            />
          ))
        ) : (
          <div className="deviceEmpty">No devices match these filters.</div>
        )}
        <footer className="devicePagination">
          <span>
            Showing {filtered.length ? (page - 1) * pageSize + 1 : 0} to{' '}
            {Math.min(page * pageSize, filtered.length)} of {filtered.length} devices
          </span>
          <div>
            <button disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>

            </button>
            <strong>{page}</strong>
            <button disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>

            </button>
          </div>
        </footer>
      </section>

      <button
        className="addDeviceButton"
        onClick={() =>
          onMessage(
            'Devices register themselves from the NovaCast TV. Use the TV pairing screen to add a device; there is no safe manual device-creation flow yet.',
          )
        }>
         Add device
      </button>

      {extendDevice ? (
        <div className="extendModalBackdrop" role="presentation" onMouseDown={() => setExtendDevice(null)}>
          <section
            className="extendModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="extend-device-title"
            onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span className="extendEyebrow">BETA ACCESS</span>
                <h2 id="extend-device-title">Extend device access</h2>
                <p>
                  {String(
                    extendDevice.friendly_name ??
                      extendDevice.assigned_tester_name ??
                      extendDevice.public_device_code ??
                      'NovaCast device',
                  )}
                </p>
              </div>
              <button className="extendClose" onClick={() => setExtendDevice(null)} aria-label="Close">

              </button>
            </header>

            <div className="extendDeviceCode">
              <small>Device ID</small>
              <strong>{String(extendDevice.public_device_code ?? 'Unassigned')}</strong>
            </div>

            <div className="extendPresetGrid">
              {[
                ['7', '7 days'],
                ['30', '30 days'],
                ['90', '90 days'],
                ['never', 'Never expires'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  className={extendPreset === value ? 'selected' : ''}
                  onClick={() => setExtendPreset(value as ExtendPreset)}>
                  {label}
                </button>
              ))}
            </div>

            <button
              className={`extendCustomToggle ${extendPreset === 'custom' ? 'selected' : ''}`}
              onClick={() => setExtendPreset('custom')}>
              Choose a custom date
            </button>

            {extendPreset === 'custom' ? (
              <label className="extendCustomDate">
                Expiration date
                <input
                  type="datetime-local"
                  value={customDate}
                  min={new Date(Date.now() + 3600000).toISOString().slice(0, 16)}
                  onChange={(event) => setCustomDate(event.target.value)}
                />
              </label>
            ) : null}

            <footer>
              <button className="extendCancel" onClick={() => setExtendDevice(null)}>
                Cancel
              </button>
              <button className="extendSave" onClick={saveExtension}>
                Save extension
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {providerDevice ? (
        <div
          className="extendModalBackdrop"
          role="presentation"
          onMouseDown={() => setProviderDevice(null)}>
          <section
            className="extendModal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="change-provider-title"
            onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <span className="extendEyebrow">MANAGED PROVIDER</span>
                <h2 id="change-provider-title">Change device provider</h2>
                <p>
                  {String(
                    providerDevice.friendly_name ??
                      providerDevice.assigned_tester_name ??
                      providerDevice.public_device_code ??
                      'NovaCast device',
                  )}
                </p>
              </div>
              <button
                className="extendClose"
                onClick={() => setProviderDevice(null)}
                aria-label="Close">
                
              </button>
            </header>

            <div className="extendDeviceCode">
              <small>Current provider</small>
              <strong>
                {providerNameById.get(String(providerDevice.managed_provider_id ?? '')) ??
                  'No provider assigned'}
              </strong>
            </div>

            {activeProviders.length ? (
              <label className="extendCustomDate">
                New provider
                <select
                  value={selectedProviderId}
                  onChange={(event) => setSelectedProviderId(event.target.value)}
                  aria-label="Select managed provider">
                  {activeProviders.map((provider) => (
                    <option key={String(provider.id)} value={String(provider.id)}>
                      {String(provider.display_name ?? provider.slug ?? 'Managed provider')}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p>No active managed providers are available.</p>
            )}

            <footer>
              <button className="extendCancel" onClick={() => setProviderDevice(null)}>
                Cancel
              </button>
              <button
                className="extendSave"
                onClick={saveProviderChange}
                disabled={!activeProviders.length || !selectedProviderId}>
                Save provider
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function DeviceMetric({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: number;
  tone: string;
  icon: string;
}) {
  return (
    <article className={`deviceMetric tone-${tone}`}>
      <span className="deviceMetricIcon">{icon}</span>
      <small>{label}</small>
      <strong>{value}</strong>
      <span className="deviceMetricHint">
        {label === 'Total devices'
          ? 'All beta devices'
          : label === 'Errors'
            ? value
              ? 'Diagnostics reported'
              : 'No error feed configured'
            : `${value ? Math.round((value / Math.max(value, 1)) * 100) : 0}% of filtered total`}
      </span>
    </article>
  );
}

function DeviceRow({
  device,
  providerName,
  onExtend,
  onChangeProvider,
  onCommand,
  onRevoke,
  onMessage,
}: {
  device: Device;
  providerName: string;
  onExtend: () => void;
  onChangeProvider: () => void;
  onCommand: Action;
  onRevoke: Action;
  onMessage: (message: string) => void;
}) {
  const id = String(device.id);
  const active = String(device.activation_status ?? 'inactive');
  const online = isOnline(device);
  const name = String(
    device.friendly_name ??
      device.assigned_tester_name ??
      device.public_device_code ??
      'NovaCast device',
  );
  const remaining = device.activation_expires_at
    ? betaRemaining(String(device.activation_expires_at))
    : active === 'active'
      ? 'Active'
      : active === 'expired'
        ? 'Expired'
        : 'Not activated';

  return (
    <div className="deviceTableRow">
      <div className="deviceIdentity">
        <span className="deviceAvatar">
          {String(device.platform ?? '').toLowerCase().includes('android') ? 'TV' : 'DV'}
        </span>
        <div>
          <strong>{String(device.public_device_code ?? 'Unassigned')}</strong>
          <small>{name}</small>
          <small>
            {String(device.manufacturer ?? '')} {String(device.model ?? '')}
          </small>
          <small>{providerName}</small>
        </div>
      </div>

      <div className={`deviceOnline ${online ? 'online' : 'offline'}`}>
        <i />
        {online ? 'Online' : 'Offline'}
      </div>

      <div>
        <b className={`betaBadge beta-${active}`}>
          {active === 'active'
            ? 'Active'
            : active === 'expired'
              ? 'Expired'
              : active === 'revoked'
                ? 'Revoked'
                : 'Inactive'}
        </b>
        <small>{remaining}</small>
      </div>

      <div>
        <strong>{relative(device.last_seen_at)}</strong>
        <small>{formatDate(device.last_seen_at)}</small>
      </div>

      <div>
        <strong>{String(device.platform ?? '-')}</strong>
        <small>{String(device.os_version ?? '')}</small>
      </div>

      <div>
        <strong>{String(device.model ?? '-')}</strong>
        <small>{String(device.device_type ?? '')}</small>
      </div>

      <div>
        <strong>{String(device.app_version ?? '-')}</strong>
        <small>{device.app_build ? `Build ${String(device.app_build)}` : 'Not installed'}</small>
      </div>

      <div className="deviceActions">
        <button
          aria-label={`View ${name}`}
          title="View device"
          onClick={() =>
            onMessage(
              `${name} - ${String(device.public_device_code ?? '')} - ${providerName} - ${String(
                device.status ?? 'registered',
              )} - ${remaining}`,
            )
          }>
          View
        </button>

        <button
          aria-label={`Extend ${name}`}
          title="Extend access"
          onClick={onExtend}>
          Extend
        </button>

        <button
          aria-label={`Change provider for ${name}`}
          title="Change provider"
          onClick={onChangeProvider}>
          Provider
        </button>

        <button
          aria-label={`Refresh ${name}`}
          title="Refresh library"
          onClick={() => onCommand(id)}>
          Refresh
        </button>

        <button
          className="dangerButton"
          aria-label={`Revoke ${name}`}
          title="Revoke device"
          onClick={() => onRevoke(id)}>
          Revoke
        </button>
      </div>
    </div>
  );
}

function isOnline(device: Device) {
  const seen = Date.parse(String(device.last_seen_at ?? ''));
  return (
    Number.isFinite(seen) &&
    seen >= Date.now() - 30 * 60 * 1000 &&
    !['revoked', 'disabled'].includes(String(device.status ?? ''))
  );
}

function relative(value: unknown) {
  const time = Date.parse(String(value ?? ''));
  if (!Number.isFinite(time)) return 'Never';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  return minutes < 1
    ? 'Just now'
    : minutes < 60
      ? `${minutes}m ago`
      : minutes < 1440
        ? `${Math.floor(minutes / 60)}h ago`
        : `${Math.floor(minutes / 1440)}d ago`;
}

function formatDate(value: unknown) {
  const time = Date.parse(String(value ?? ''));
  return Number.isFinite(time)
    ? new Date(time).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'No heartbeat recorded';
}

function betaRemaining(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'Active';
  const hours = Math.ceil((time - Date.now()) / 3600000);
  if (hours <= 0) return 'Expired';
  if (hours >= 24 * 365 * 50) return 'Never expires';
  if (hours >= 48) return `${Math.ceil(hours / 24)}d remaining`;
  return `${hours}h remaining`;
}
