import { useCallback, useEffect, useRef, useState } from 'react';

import { nextNovaPulseIndex, canNovaPulseAutoRotate, resolveNovaPulseAction } from './novaPulseLogic';
import { preserveNovaPulseIndex } from './novaPulseComposer';
import type { NovaPulseItem } from './novaPulseTypes';

export const NOVA_PULSE_ROTATION_MS = 8_000;

type UseNovaPulseOptions = {
  items: readonly NovaPulseItem[];
  onAction?: (item: NovaPulseItem) => void;
  onEvent?: (event: string, item: NovaPulseItem) => void;
};

export function useNovaPulse({ items, onAction, onEvent }: UseNovaPulseOptions) {
  const [index, setIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedRef = useRef(false);
  const activeIdRef = useRef<string | null>(null);
  const indexRef = useRef(0);
  const itemsRef = useRef<readonly NovaPulseItem[]>(items);
  const onEventRef = useRef(onEvent);
  itemsRef.current = items;
  onEventRef.current = onEvent;
  const activeItems = items.length ? items : [];
  const preservedIndex = activeIdRef.current ? activeItems.findIndex((candidate) => candidate.id === activeIdRef.current) : -1;
  const currentIndex = preservedIndex >= 0 ? preservedIndex : Math.min(index, Math.max(activeItems.length - 1, 0));
  const item = activeItems[currentIndex] ?? activeItems[0] ?? null;

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const move = useCallback((direction: -1 | 1, source: 'auto' | 'manual') => {
    const currentItems = itemsRef.current;
    if (currentItems.length <= 1) return;
    const currentItemIndex = activeIdRef.current
      ? currentItems.findIndex((candidate) => candidate.id === activeIdRef.current)
      : -1;
    const baseIndex = currentItemIndex >= 0 ? currentItemIndex : Math.min(indexRef.current, currentItems.length - 1);
    const nextIndex = nextNovaPulseIndex(currentItems.length, baseIndex, direction);
    activeIdRef.current = currentItems[nextIndex]?.id ?? null;
    indexRef.current = nextIndex;
    setIndex(nextIndex);
    const nextItem = currentItems[nextIndex];
    if (nextItem) onEventRef.current?.(source === 'auto' ? 'novapulse_impression' : 'novapulse_manual_change', nextItem);
  }, []);

  const setFocus = useCallback((nextFocused: boolean) => {
    focusedRef.current = nextFocused;
    setFocused(nextFocused);
    clearTimer();
    const current = itemsRef.current[currentIndex];
    if (nextFocused && current) onEvent?.('novapulse_focused', current);
  }, [clearTimer, currentIndex, onEvent]);

  const previous = useCallback(() => move(-1, 'manual'), [move]);
  const next = useCallback(() => move(1, 'manual'), [move]);

  const activate = useCallback(() => {
    const current = activeItems[currentIndex];
    const action = current ? resolveNovaPulseAction(current) : null;
    if (!current || !action) return false;
    onEvent?.('novapulse_action', current);
    onAction?.(current);
    return true;
  }, [activeItems, currentIndex, onAction, onEvent]);

  useEffect(() => {
    if (!activeItems.length) {
      activeIdRef.current = null;
      return;
    }
    const nextIndex = preserveNovaPulseIndex(activeItems, activeIdRef.current, index);
    activeIdRef.current = activeItems[nextIndex]?.id ?? null;
    indexRef.current = nextIndex;
    if (nextIndex !== index) setIndex(nextIndex);
  }, [activeItems, index]);

  useEffect(() => {
    clearTimer();
    if (!canNovaPulseAutoRotate(activeItems.length, focusedRef.current)) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!focusedRef.current) move(1, 'auto');
    }, NOVA_PULSE_ROTATION_MS);
    return clearTimer;
  }, [activeItems.length, item?.id, clearTimer, focused, move]);

  useEffect(() => clearTimer, [clearTimer]);

  return { index: currentIndex, item, focused, setFocus, previous, next, activate, canRotate: activeItems.length > 1 };
}
