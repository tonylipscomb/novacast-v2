/**
 * Movies browse list-host focusability.
 *
 * Android TV focuses the native FlatList ScrollView when child rows are
 * disabled. The RN `focusable={false}` prop does not reach that host.
 */

type NativeFocusProps = {
  focusable: boolean;
  accessible: boolean;
};

type ListHostNative = {
  setNativeProps?: (props: NativeFocusProps) => void;
  getNativeScrollRef?: () => { setNativeProps?: (props: NativeFocusProps) => void } | null;
  getScrollRef?: () => { setNativeProps?: (props: NativeFocusProps) => void } | null;
};

export function resolveMoviesBrowseListHostProps(input: {
  hostEnabled: boolean;
  lockScroll?: boolean;
}): {
  hostFocusable: boolean;
  scrollEnabled: boolean;
} {
  return {
    hostFocusable: false,
    scrollEnabled: input.hostEnabled && !input.lockScroll,
  };
}

export function shouldLogUnexpectedMoviesBrowseHostFocus(input: {
  detailPopupOpen: boolean;
  playbackUiActive?: boolean;
}): boolean {
  return input.detailPopupOpen === true && !input.playbackUiActive;
}

export function applyMoviesBrowseListHostNativeFocus(list: unknown, hostFocusable: boolean): void {
  if (list == null || (typeof list !== 'object' && typeof list !== 'function')) {
    return;
  }
  const props: NativeFocusProps = {
    focusable: hostFocusable,
    accessible: hostFocusable,
  };
  const candidate = list as ListHostNative;
  try {
    candidate.setNativeProps?.(props);
  } catch {
    // Host focus must never crash browse.
  }
  try {
    const scroll = candidate.getNativeScrollRef?.() ?? candidate.getScrollRef?.() ?? null;
    scroll?.setNativeProps?.(props);
  } catch {
    // Host focus must never crash browse.
  }
}
