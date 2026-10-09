import { useMemo, useState } from 'react';
import { filterAdminDevices } from './operationsCenter';

type Device = Record<string, unknown>;
type Provider = Record<string, unknown>;
type Action = (id: string) => void;
type AssignProviderAction = (id: string, managedProviderId: string) => void;
type ViewDeviceAction = (device: Device) => void;
type DeviceQuery = { page: number; pageSize: number; search: string; status: string; platform: string; activation: string; version: string; providerId: string; providerHealth: string };
type DevicePagination = { page: number; pageSize: number; total: number; totalPages: number };

export function AdminDevices({
  devices,
  providers,
  onAssignProvider,
  onCommand,
  onRevoke,
  onMessage,
  onView,
  pagination,
  query: serverQuery,
  onQueryChange,
}: {
  devices: Device[];
  providers: Provider[];
  onAssignProvider: AssignProviderAction;
  onCommand: Action;
  onRevoke: Action;
  onMessage: (message: string) => void;
  onView: ViewDeviceAction;
  pagination: DevicePagination;
  query: DeviceQuery;
  onQueryChange: (query: DeviceQuery) => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [platform, setPlatform] = useState('all');
  const [activation, setActivation] = useState('all');
  const [version, setVersion] = useState('all');
  const [providerId, setProviderId] = useState('all');
  const [providerHealth, setProviderHealth] = useState('all');
  const [, setPage] = useState(1);
  const [providerDevice, setProviderDevice] = useState<Device | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState('');

  const providerNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const provider of providers) {
      const id = String(provider.id ?? '');
      if (!id) continue;
      map.set(id, String(provider.display_name ?? provider.slug ?? 'Managed provider'));
    }
    return map;
  }, [providers]);
  const providerHealthById = useMemo(() => {
    const map = new Map<string, string>();
    for (const provider of providers) {
      const id = String(provider.id ?? '');
      if (id) map.set(id, String(provider.health_status ?? 'Not reported'));
    }
    return map;
  }, [providers]);
  const notifyQuery = (patch: Partial<DeviceQuery>) => onQueryChange({ ...serverQuery, ...patch, page: 1 });

  const activeProviders = useMemo(
    () => providers.filter((provider) => String(provider.status ?? 'active') === 'active'),
    [providers],
  );

  const filtered = useMemo(
    () => filterAdminDevices(devices, { query, status, platform, activation, version, providerId, providerHealth }, providers),
    [devices, providers, query, status, platform, activation, version, providerId, providerHealth],
  );

  const pageCount = Math.max(1, pagination.totalPages || 1);
  const visible = filtered;
  const counts = {
    total: pagination.total,
    online: devices.filter(isOnline).length,
    active: devices.filter((device) => String(device.status ?? '').toLowerCase() === 'active').length,
    registered: devices.filter((device) => String(device.status ?? '').toLowerCase() === 'registered').length,
    offline: devices.filter((device) => !isOnline(device)).length,
    errors: devices.filter((device) => Boolean(device.last_diagnostics)).length,
  };
  const platforms = [...new Set(devices.map((device) => String(device.platform ?? '')).filter(Boolean))];
  const versions = [...new Set(devices.map((device) => String(device.app_version ?? '')).filter(Boolean))];
  const providerHealthValues = [...new Set(providers.map((provider) => String(provider.health_status ?? '')).filter(Boolean))];

  const clear = () => {
    setQuery('');
    setStatus('all');
    setPlatform('all');
    setActivation('all');
    setVersion('all');
    setProviderId('all');
    setProviderHealth('all');
    setPage(1);
    onQueryChange({ ...serverQuery, search: '', status: 'all', platform: 'all', activation: 'all', version: '', providerId: '', providerHealth: 'all', page: 1 });
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

  return (
    <div className="devicesPage">
      <div className="deviceMetricGrid">
        <DeviceMetric label="Total devices" value={counts.total} tone="blue" icon="" />
        <DeviceMetric label="Online" value={counts.online} tone="green" icon="" />
        <DeviceMetric label="Active" value={counts.active} tone="purple" icon="" />
        <DeviceMetric label="Registered" value={counts.registered} tone="amber" icon="" />
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
              notifyQuery({ search: event.target.value });
            }}
            placeholder="Search devices by name, ID, model, or platform"
          />
        </label>
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
            notifyQuery({ status: event.target.value });
          }}
          aria-label="Filter by status">
          <option value="all">All devices</option>
          <option value="online">Online</option>
          <option value="active">Active</option>
          <option value="registered">Registered</option>
          <option value="suspended">Suspended</option>
          <option value="revoked">Revoked</option>
          <option value="blocked">Blocked</option>
          <option value="disabled">Disabled</option>
          <option value="offline">Offline</option>
        </select>
        <select
          value={platform}
          onChange={(event) => {
            setPlatform(event.target.value);
            setPage(1);
            notifyQuery({ platform: event.target.value });
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
          value={activation}
          onChange={(event) => {
            setActivation(event.target.value);
            setPage(1);
            notifyQuery({ activation: event.target.value });
          }}
          aria-label="Filter by activation history">
          <option value="all">All activation history</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="revoked">Revoked</option>
        </select>
        <select value={version} onChange={(event) => { setVersion(event.target.value); setPage(1); notifyQuery({ version: event.target.value }); }} aria-label="Filter by app version">
          <option value="all">All app versions</option>
          {versions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select value={providerId} onChange={(event) => { setProviderId(event.target.value); setPage(1); notifyQuery({ providerId: event.target.value }); }} aria-label="Filter by provider">
          <option value="all">All providers</option>
          {providers.map((provider) => <option key={String(provider.id)} value={String(provider.id)}>{String(provider.display_name ?? provider.slug ?? 'Provider')}</option>)}
        </select>
        <select value={providerHealth} onChange={(event) => { setProviderHealth(event.target.value); setPage(1); notifyQuery({ providerHealth: event.target.value }); }} aria-label="Filter by provider health">
          <option value="all">All provider health</option>
          {providerHealthValues.map((item) => <option key={item} value={item}>{item}</option>)}
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
          <span>Online</span>
          <span>Provider</span>
          <span>Provider status</span>
          <span>App version</span>
          <span>Last seen</span>
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
              providerHealth={providerHealthById.get(String(device.managed_provider_id ?? '')) ?? 'Not reported'}
              onChangeProvider={() => openChangeProvider(device)}
              onCommand={onCommand}
              onRevoke={onRevoke}
              onView={onView}
            />
          ))
        ) : (
          <div className="deviceEmpty">No devices match these filters.</div>
        )}
        <footer className="devicePagination">
          <span>
            Showing {pagination.total ? (pagination.page - 1) * pagination.pageSize + 1 : 0} to{' '}
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total} devices
          </span>
          <div>
            <button disabled={pagination.page <= 1} onClick={() => { const next = pagination.page - 1; setPage(next); onQueryChange({ ...serverQuery, page: next }); }}>

            </button>
            <strong>{pagination.page}</strong>
            <button disabled={pagination.page >= pageCount} onClick={() => { const next = pagination.page + 1; setPage(next); onQueryChange({ ...serverQuery, page: next }); }}>

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
          ? 'All devices'
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
  providerHealth,
  onChangeProvider,
  onCommand,
  onRevoke,
  onView,
}: {
  device: Device;
  providerName: string;
  providerHealth: string;
  onChangeProvider: () => void;
  onCommand: Action;
  onRevoke: Action;
  onView: ViewDeviceAction;
}) {
  const id = String(device.id);
  const lifecycleStatus = String(device.status ?? 'unknown').toLowerCase();
  const online = isOnline(device);
  const name = String(
    device.friendly_name ??
      device.assigned_tester_name ??
      device.public_device_code ??
      'NovaCast device',
  );
  const legacy = String(device.activation_source ?? '').toLowerCase() !== ''
    ? String(device.activation_source).toLowerCase() !== 'production'
    : String(device.activation_status ?? '').toLowerCase() === 'expired';
  const assignment = device.assignment_id ? 'Assigned' : 'Unassigned';

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
          <small>Assignment: {assignment}{device.assigned_at ? ` · ${formatDate(device.assigned_at)}` : ''}</small>
          {legacy ? <small>Legacy activation</small> : null}
        </div>
      </div>

      <div>
        <b className={`deviceStatusBadge status-${lifecycleStatus}`}>{lifecycleStatus === 'unknown' ? 'Unknown' : lifecycleStatus[0].toUpperCase() + lifecycleStatus.slice(1)}</b>
        {device.activation_source ? <small>{String(device.activation_source) === 'production' ? 'Production activation' : 'Legacy activation'}</small> : null}
      </div>

      <div className={`deviceOnline ${online ? 'online' : 'offline'}`}>
        <i />
        {online ? 'Online' : 'Offline'}
      </div>

      <div>
        <strong>{providerName}</strong>
        <small>{assignment}</small>
      </div>

      <div>
        <strong>{providerHealth}</strong>
        <small>Provider health</small>
      </div>

      <div>
        <strong>{String(device.app_version ?? '-')}</strong>
        <small>{device.app_build ? `Build ${String(device.app_build)}` : 'Not installed'}</small>
      </div>

      <div>
        <strong>{relative(device.last_seen_at)}</strong>
        <small>{formatDate(device.last_seen_at)}</small>
      </div>

      <div className="deviceActions">
        <button
          aria-label={`View ${name}`}
          title="View device"
          onClick={() => onView(device)}>
          View
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
