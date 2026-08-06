export function createAsyncRootsCache(load, { pathAffectsRoots = () => true } = {}) {
  const entries = new Map();

  return {
    get(roots) {
      const key = JSON.stringify(roots);
      const existing = entries.get(key);
      if (existing) {
        return existing.promise;
      }
      const entry = { roots: [...roots] };
      entry.promise = Promise.resolve()
        .then(() => load(entry.roots))
        .catch((error) => {
          if (entries.get(key) === entry) {
            entries.delete(key);
          }
          throw error;
        });
      entries.set(key, entry);
      return entry.promise;
    },

    invalidatePath(filePath) {
      for (const [key, entry] of entries) {
        if (pathAffectsRoots(filePath, entry.roots)) {
          entries.delete(key);
        }
      }
    },

    clear() {
      entries.clear();
    },
  };
}
