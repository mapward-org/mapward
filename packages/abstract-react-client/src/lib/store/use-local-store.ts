import { useEffect, useState } from "react";

/**
 * Стор, у которого есть жизнь: подписки, слушатели окна, таймеры. Заводит их `mount`, а снимает
 * `unmount` — не конструктор: React в строгом режиме монтирует компонент дважды, и то, что
 * завёл конструктор, после первого снятия пропало бы навсегда.
 */
export type Mountable = { mount?: () => void; unmount?: () => void };

const same = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((value, index) => Object.is(value, b[index]));

/**
 * Локальный стор компонента — решение 0042: `useLocalStore(() => new Store(глобальные))`.
 * Стор создаётся один раз на жизнь компонента; изменились `deps` — создаётся новый, а старый
 * снимается. Это единственное место клиента, где состояние держит сам React: хранить стор
 * больше негде.
 */
export function useLocalStore<T extends object & Mountable>(
  create: () => T,
  deps: readonly unknown[] = [],
): T {
  const [slot, setSlot] = useState(() => ({ deps, store: create() }));
  let current = slot;
  if (!same(slot.deps, deps)) {
    current = { deps, store: create() };
    setSlot(current);
  }
  const store = current.store;
  useEffect(() => {
    store.mount?.();
    return () => store.unmount?.();
  }, [store]);
  return store;
}
