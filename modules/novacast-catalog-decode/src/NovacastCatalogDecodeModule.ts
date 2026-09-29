import { NativeModule, requireNativeModule } from 'expo';

import type {
  CatalogDecodeBatch,
  CatalogDecodeJobStart,
  StartCatalogDecodeOptions,
} from './NovacastCatalogDecode.types';

declare class NovacastCatalogDecodeModuleType extends NativeModule {
  isNativeDecodeAvailable(): Promise<boolean>;
  startDecodeJob(options: StartCatalogDecodeOptions): Promise<CatalogDecodeJobStart>;
  pullDecodeBatch(jobId: string): Promise<CatalogDecodeBatch>;
  cancelDecodeJob(jobId: string): Promise<{ cancelled: boolean; jobId: string }>;
}

let cached: NovacastCatalogDecodeModuleType | null | undefined;

export function getNovacastCatalogDecodeModule(): NovacastCatalogDecodeModuleType | null {
  if (cached !== undefined) {
    return cached;
  }
  try {
    cached = requireNativeModule<NovacastCatalogDecodeModuleType>('NovacastCatalogDecode');
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

export default getNovacastCatalogDecodeModule();
