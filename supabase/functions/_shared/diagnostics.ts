export function pairingDiagnostic(event: string, details: Record<string, string | number | boolean> = {}) {
  if (Deno.env.get('PAIRING_DEBUG') !== 'true') {
    return;
  }

  console.info(`[NovaCastPairing] ${event}`, JSON.stringify(details));
}
