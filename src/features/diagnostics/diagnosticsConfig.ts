export const DIAGNOSTICS_DISCLOSURE_VERSION = '1';
export const DIAGNOSTICS_DISCLOSURE_KEY = 'novacast.beta-diagnostics-disclosure.v1';
// null means the device has not received the server's diagnostics decision yet.
// Keep early lifecycle events in the bounded client queue until that decision
// arrives; do not silently lose the launch/playback handoff during startup.
let diagnosticsEnabled: boolean | null = null;

export function setDiagnosticsEnabled(value: boolean) {
  diagnosticsEnabled = value;
  if (value) {
    void import('./diagnosticCapture').then(({ hydrateDiagnosticCapture }) => hydrateDiagnosticCapture());
    void import('./diagnosticsClient').then(({ flushDiagnostics }) => flushDiagnostics());
  }
}
export function isDiagnosticsEnabled() { return diagnosticsEnabled; }
export function shouldBufferDiagnostics() { return diagnosticsEnabled !== false; }
