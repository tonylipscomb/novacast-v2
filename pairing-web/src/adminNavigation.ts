export type AdminTab =
  | 'dashboard'
  | 'devices'
  | 'providers'
  | 'diagnostics'
  | 'playback'
  | 'gold'
  | 'invitations'
  | 'announcements'
  | 'settings';

export type AdminNavItem = {
  id: string;
  label: string;
  icon: string;
  tab?: AdminTab;
  href?: string;
  disabled?: boolean;
  note?: string;
};

export type AdminNavGroup = { label?: string; items: AdminNavItem[] };
export type DeviceInspectorTab = 'overview' | 'provider' | 'diagnostics' | 'playback' | 'activity';
export type AdminLocation = { tab: AdminTab; deviceKey?: string; inspectorTab?: DeviceInspectorTab };

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  { items: [{ id: 'overview', label: 'Overview', icon: 'O', tab: 'dashboard' }] },
  {
    label: 'Operations',
    items: [
      { id: 'devices', label: 'Devices', icon: 'V', tab: 'devices' },
      { id: 'providers', label: 'Providers', icon: 'P', tab: 'providers' },
      { id: 'pairing', label: 'Pairing', icon: '↗', href: '/pair' },
      { id: 'diagnostics', label: 'Diagnostics', icon: 'D', tab: 'diagnostics' },
      { id: 'playback', label: 'Playback', icon: '▶', tab: 'playback' },
    ],
  },
  {
    label: 'Content',
    items: [
      { id: 'novapulse', label: 'NovaPulse', icon: 'N', tab: 'announcements' },
      { id: 'catalog', label: 'Catalog', icon: 'C', disabled: true, note: 'Coming later' },
      { id: 'epg', label: 'EPG', icon: 'E', disabled: true, note: 'Coming later' },
    ],
  },
  {
    label: 'Management',
    items: [
      { id: 'gold', label: 'Gold Panel', icon: 'G', tab: 'gold' },
      { id: 'app-releases', label: 'App Releases', icon: 'R', disabled: true, note: 'Coming later' },
      { id: 'release-testing', label: 'Release Testing', icon: 'I', tab: 'invitations' },
    ],
  },
  {
    label: 'Insights',
    items: [
      { id: 'analytics', label: 'Analytics', icon: 'A', disabled: true, note: 'Coming later' },
      { id: 'events', label: 'Events', icon: '•', disabled: true, note: 'Coming later' },
      { id: 'errors', label: 'Errors', icon: '!', disabled: true, note: 'Coming later' },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'service-health', label: 'Service Health', icon: '♥', disabled: true, note: 'Coming later' },
      { id: 'feature-flags', label: 'Feature Flags', icon: 'F', disabled: true, note: 'Coming later' },
      { id: 'audit-log', label: 'Audit Log', icon: 'L', disabled: true, note: 'Coming later' },
      { id: 'settings', label: 'Settings', icon: 'S', tab: 'settings' },
    ],
  },
];

const TAB_PATHS: Record<AdminTab, string> = {
  dashboard: '/admin/overview',
  devices: '/admin/devices',
  providers: '/admin/providers',
  diagnostics: '/admin/diagnostics',
  playback: '/admin/playback',
  gold: '/admin/gold',
  invitations: '/admin/release-testing',
  announcements: '/admin/novapulse',
  settings: '/admin/settings',
};

export function resolveAdminTab(pathname: string): AdminTab {
  const path = pathname.replace(/\/+$/, '') || '/';
  switch (path) {
    case '/admin':
    case '/admin/':
    case '/admin/overview':
      return 'dashboard';
    case '/admin/devices': return 'devices';
    case '/admin/providers': return 'providers';
    case '/admin/diagnostics':
    case '/admin/analytics': return 'diagnostics';
    case '/admin/playback': return 'playback';
    case '/admin/gold': return 'gold';
    case '/admin/release-testing':
    case '/admin/invitations': return 'invitations';
    case '/admin/novapulse':
    case '/admin/announcements': return 'announcements';
    case '/admin/settings': return 'settings';
    default: return 'dashboard';
  }
}

export function adminPathForTab(tab: AdminTab): string {
  return TAB_PATHS[tab];
}

export function adminPathForDevice(deviceKey: string, tab: DeviceInspectorTab = 'overview'): string {
  const encoded = encodeURIComponent(deviceKey);
  return tab === 'overview' ? `/admin/devices/${encoded}` : `/admin/devices/${encoded}/${tab}`;
}

export function resolveAdminLocation(pathname: string): AdminLocation {
  const path = pathname.replace(/\/+$/, '') || '/';
  const match = path.match(/^\/admin\/devices\/([^/]+)(?:\/(overview|provider|diagnostics|playback|activity))?$/);
  if (match) {
    return { tab: 'devices', deviceKey: decodeURIComponent(match[1]), inspectorTab: (match[2] as DeviceInspectorTab | undefined) ?? 'overview' };
  }
  return { tab: resolveAdminTab(path) };
}
