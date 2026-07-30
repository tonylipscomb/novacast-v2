export type CatalogProgressSnapshot = Record<string, unknown>;

export type CatalogProgressThrottle = {
  publish: (snapshot: CatalogProgressSnapshot) => void;
  flush: () => void;
};

function snapshotsEqual(
  left: CatalogProgressSnapshot,
  right: CatalogProgressSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createCatalogProgressThrottle(options: {
  intervalMs: number;
  write: (snapshot: CatalogProgressSnapshot) => void | Promise<void>;
}): CatalogProgressThrottle {
  let lastWritten: CatalogProgressSnapshot | null = null;
  let pending: CatalogProgressSnapshot | null = null;
  let lastWriteAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const writePending = (force: boolean) => {
    if (!pending) {
      return;
    }
    if (!force && lastWritten && snapshotsEqual(lastWritten, pending)) {
      pending = null;
      return;
    }
    const snapshot = pending;
    pending = null;
    lastWritten = snapshot;
    lastWriteAt = Date.now();
    void options.write(snapshot);
  };

  const flush = () => {
    clearTimer();
    writePending(true);
  };

  const publish = (snapshot: CatalogProgressSnapshot) => {
    if (lastWritten && snapshotsEqual(lastWritten, snapshot)) {
      return;
    }
    if (pending && snapshotsEqual(pending, snapshot)) {
      return;
    }

    pending = snapshot;
    const elapsed = Date.now() - lastWriteAt;
    if (elapsed >= options.intervalMs) {
      flush();
      return;
    }

    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        writePending(false);
      }, options.intervalMs - elapsed);
    }
  };

  return {
    publish,
    flush,
  };
}
