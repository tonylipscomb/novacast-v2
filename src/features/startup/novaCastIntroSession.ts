/**
 * Process-lifetime intro gate.
 * A true Android/Fire TV process restart resets this module and allows the
 * branding video again. In-app navigation does not.
 */

let hasPlayedIntroThisProcess = false;

export function shouldPlayNovaCastIntro(): boolean {
  return !hasPlayedIntroThisProcess;
}

export function markNovaCastIntroPlayed(): void {
  hasPlayedIntroThisProcess = true;
}

export function resetNovaCastIntroSessionForTests(): void {
  hasPlayedIntroThisProcess = false;
}
