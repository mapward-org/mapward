import { useCallback, useEffect, useState } from "react";

type Store = {
  get: (key: string) => Promise<unknown>;
  set: (key: string, value: unknown) => void;
};

/**
 * State that outlives a render but is not worth a stream: folded sections, pan and zoom.
 * Reads once, writes on change — the store is the editor's, not ours.
 *
 * The third value says the store has answered. Until then `value` is `initial`, and a write
 * made that early is overwritten by the answer — who cares, waits for it.
 */
export function useStored<T>(
  store: Store,
  key: string,
  initial: T,
): [T, (value: T) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    // Сменился ключ — это состояние другого объекта. Не сбросив своё, компонент показывал бы
    // чужое: стор про новый ключ может не знать ничего, и тогда прежнее осталось бы навсегда,
    // а первая же запись сохранила бы чужие ключи под новым адресом.
    setValue(initial);
    setLoaded(false);
    void store.get(key).then((stored) => {
      if (!alive) return;
      if (stored !== undefined) setValue(stored as T);
      setLoaded(true);
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

  return [value, put, loaded];
}
