import { useCallback, useEffect, useState } from "react";

type Store = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => void;
};

/**
 * State that outlives a render but is not worth a stream: folded sections, pan and zoom.
 * Reads once, writes on change — the store is the editor's, not ours.
 */
export function useStored<T>(store: Store, key: string, initial: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    let alive = true;
    void store.get(key).then((stored) => {
      if (alive && stored !== undefined) setValue(stored as T);
    });
    return () => {
      alive = false;
    };
    // oxlint-disable-next-line exhaustive-deps
  }, [key]);

  const put = useCallback(
    (next: T) => {
      setValue(next);
      store.set(key, next);
    },
    // oxlint-disable-next-line exhaustive-deps
    [key],
  );

  return [value, put];
}
