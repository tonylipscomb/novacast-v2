import { createFavoriteHoldDetector } from '../live/liveFavoriteHold.ts';
import type { LiveSearchResult } from './searchTypes';

export function createSearchLiveFavoriteController(input: {
  onToggle: (result: LiveSearchResult) => void;
  detectorOptions?: Partial<Parameters<typeof createFavoriteHoldDetector>[0]>;
}) {
  let focused: LiveSearchResult | null = null;
  let suppressedId: string | null = null;
  const detector = createFavoriteHoldDetector({
    ...input.detectorOptions,
    onTriggered: () => {
      if (!focused) return;
      suppressedId = focused.id;
      input.onToggle(focused);
    },
  });
  return {
    setFocused(result: LiveSearchResult | null) {
      focused = result;
      if (!result) detector.cancel('search-focus-cleared');
    },
    handleNativeEvent(event: { keyCode?: number; action?: number; repeatCount?: number }) {
      if (event.keyCode !== 23 && event.keyCode !== 66 && event.keyCode !== 160) return;
      detector.handleEvent({ keyCode: event.keyCode, eventKeyAction: event.action, repeatCount: event.repeatCount });
    },
    consumeSuppressedPress(id: string) {
      if (suppressedId !== id) return false;
      suppressedId = null;
      detector.consumeSuppressedPress();
      return true;
    },
    cancel(reason = 'search-controller-cancelled') {
      detector.cancel(reason);
      focused = null;
      suppressedId = null;
    },
  };
}
