import { NativeModule, requireNativeModule } from 'expo';

declare class FullscreenSurfNativeModule extends NativeModule {
  setFullscreenSurfEnabled(enabled: boolean): boolean;
}

let cached: FullscreenSurfNativeModule | null | undefined;

function getModule(): FullscreenSurfNativeModule | null {
  if (cached !== undefined) {
    return cached;
  }
  try {
    cached = requireNativeModule<FullscreenSurfNativeModule>('NovacastFullscreenSurf');
  } catch {
    cached = null;
  }
  return cached;
}

export function setFullscreenSurfEnabled(enabled: boolean): boolean {
  return getModule()?.setFullscreenSurfEnabled(enabled) ?? false;
}
