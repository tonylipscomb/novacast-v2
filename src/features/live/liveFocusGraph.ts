export type LiveFocusGraphEntry = {
  id: string;
  index: number;
  handle: number;
};

export type LiveFocusGraphProps = {
  nextFocusUp: number;
  nextFocusDown: number;
  nextFocusRight: number;
};

export function buildLiveFocusGraph(
  entries: readonly LiveFocusGraphEntry[],
  channelNextFocusUpHandle?: number,
): Map<string, LiveFocusGraphProps> {
  const byIndex = new Map(entries.map((entry) => [entry.index, entry]));
  const graph = new Map<string, LiveFocusGraphProps>();

  for (const entry of entries) {
    const previous = byIndex.get(entry.index - 1);
    const next = byIndex.get(entry.index + 1);
    graph.set(entry.id, {
      nextFocusUp: entry.index === 0 ? channelNextFocusUpHandle ?? entry.handle : previous?.handle ?? entry.handle,
      nextFocusDown: next?.handle ?? entry.handle,
      nextFocusRight: entry.handle,
    });
  }

  return graph;
}

export function areLiveFocusGraphPropsEqual(
  left: LiveFocusGraphProps | undefined,
  right: LiveFocusGraphProps,
) {
  return Boolean(
    left &&
      left.nextFocusUp === right.nextFocusUp &&
      left.nextFocusDown === right.nextFocusDown &&
      left.nextFocusRight === right.nextFocusRight,
  );
}
