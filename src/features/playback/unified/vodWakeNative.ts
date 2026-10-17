import { NativeModule, requireNativeModule } from 'expo';

export type VodWakeKeyEvent = {
  eventType?: string;
  keyCode?: number;
  eventKeyAction?: number;
  repeatCount?: number;
  eventTime?: number;
  downTime?: number;
  activeOwner?: string;
  focusedView?: string;
};

type VodWakeEvents = {
  onVodWakeKey(event: VodWakeKeyEvent): void;
};

declare class VodWakeNativeModule extends NativeModule<VodWakeEvents> {
  setVodWakeEnabled(enabled: boolean): boolean;
}

let cachedModule: VodWakeNativeModule | null | undefined;

function getModule(): VodWakeNativeModule | null {
  if (cachedModule !== undefined) {
    return cachedModule;
  }
  try {
    cachedModule = requireNativeModule<VodWakeNativeModule>('NovacastVodWake');
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

export function setVodWakeEnabled(enabled: boolean): boolean {
  return getModule()?.setVodWakeEnabled(enabled) ?? false;
}

export function subscribeVodWakeKeys(
  listener: (event: VodWakeKeyEvent) => void,
): { remove: () => void } | null {
  return getModule()?.addListener('onVodWakeKey', listener) ?? null;
}
