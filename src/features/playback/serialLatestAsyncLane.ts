export function createSerialLatestAsyncLane<T>(run: (value: T) => PromiseLike<void> | void) {
  let active = false;
  let pending: T | undefined;
  let idlePromise: Promise<void> | null = null;

  const drain = async () => {
    active = true;
    while (pending !== undefined) {
      const next = pending;
      pending = undefined;
      try {
        await run(next);
      } catch {
        // One failed replacement must not strand the newest pending target.
      }
    }
    active = false;
    idlePromise = null;
  };

  return {
    enqueue(value: T) {
      pending = value;
      if (!active) {
        idlePromise = drain();
      }
    },
    get isActive() {
      return active;
    },
    get pendingValue() {
      return pending;
    },
    async waitForIdle() {
      await idlePromise;
    },
  };
}
