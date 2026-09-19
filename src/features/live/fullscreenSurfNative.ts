import { NativeModule, requireNativeModule } from 'expo';

export type FullscreenSurfKeyEvent = {
  keyCode?: number;
  action?: number;
  repeatCount?: number;
  eventTime?: number;
  downTime?: number;
};

type FullscreenSurfEvents = {
  onFullscreenSurfKey(event: FullscreenSurfKeyEvent): void;
};

declare class FullscreenSurfNativeModule extends NativeModule<FullscreenSurfEvents> {
  setFullscreenSurfEnabled(enabled: boolean): boolean;
}

let cachedModule: FullscreenSurfNativeModule | null | undefined;

function getModule(): FullscreenSurfNativeModule | null {
  if (cachedModule !== undefined) {
    return cachedModule;
  }
  try {
    cachedModule = requireNativeModule<FullscreenSurfNativeModule>('NovacastFullscreenSurf');
  } catch {
    cachedModule = null;
  }
  return cachedModule;
}

export function setFullscreenSurfEnabled(enabled: boolean): boolean {
  return getModule()?.setFullscreenSurfEnabled(enabled) ?? false;
}

export function subscribeFullscreenSurfKeys(
  listener: (event: FullscreenSurfKeyEvent) => void,
): { remove: () => void } | null {
  return getModule()?.addListener('onFullscreenSurfKey', listener) ?? null;
}
