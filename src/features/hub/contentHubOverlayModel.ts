export const CONTENT_HUB_PRIMARY_ACTIONS = [
  { id: 'home', label: 'Home', icon: 'home-outline', route: null },
  { id: 'settings', label: 'Settings', icon: 'cog-outline', route: '/settings' },
  { id: 'provider', label: 'Add Provider', icon: 'qrcode-scan', route: '/pair' },
] as const;

export type ContentHubActionId = (typeof CONTENT_HUB_PRIMARY_ACTIONS)[number]['id'];

export function getInitialContentHubActionId() {
  return CONTENT_HUB_PRIMARY_ACTIONS[0].id;
}
