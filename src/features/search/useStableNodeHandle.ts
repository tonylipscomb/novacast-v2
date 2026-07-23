import type { RefObject } from 'react';
import { useLayoutEffect, useState } from 'react';
import { findNodeHandle, type TextInput, type View } from 'react-native';

/** Resolve a native node handle once after layout; only re-set state when the handle changes. */
export function useStableNodeHandle(ref: RefObject<View | TextInput | null>, deps: readonly unknown[]) {
  const [handle, setHandle] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const next = ref.current ? findNodeHandle(ref.current) ?? undefined : undefined;
    setHandle((prev) => (prev === next ? prev : next));
  }, deps);

  return handle;
}
