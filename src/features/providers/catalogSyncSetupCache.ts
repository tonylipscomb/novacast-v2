export function setEvictingCachedPromise<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  promise: Promise<T>,
): Promise<T> {
  cache.set(key, promise);
  void promise.then(
    () => undefined,
    () => {
      if (cache.get(key) === promise) {
        cache.delete(key);
      }
    },
  );
  return promise;
}
