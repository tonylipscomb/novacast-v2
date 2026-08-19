/**
 * Development-only Live TV selection diagnostics.
 * Safe fields only — never log URLs, credentials, or tokens.
 */

export type LiveSelectionEvent =
  | 'focus-changed'
  | 'preview-requested'
  | 'preview-active'
  | 'fullscreen-requested'
  | 'stale-preview-ignored';

export type LiveSelectionDiagnosticFields = {
  focusedChannelId?: string | null;
  activePreviewChannelId?: string | null;
  actionSource?: string;
  requestToken?: number;
};

declare const __DEV__: boolean | undefined;

export function logLiveSelection(event: LiveSelectionEvent, fields: LiveSelectionDiagnosticFields = {}): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    return;
  }

  console.info('[NovaCast Live Selection]', {
    event,
    focusedChannelId: fields.focusedChannelId ?? null,
    activePreviewChannelId: fields.activePreviewChannelId ?? null,
    ...(fields.actionSource ? { actionSource: fields.actionSource } : {}),
    ...(fields.requestToken != null ? { requestToken: fields.requestToken } : {}),
  });
}
