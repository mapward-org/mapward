import { useEffect, useState } from "react";
import type { Observable } from "rxjs";

/**
 * A factory rather than an observable: `bridge.watchMaps()` returns a fresh stream on every
 * call, and passing that directly would resubscribe on every render. Deps say when the
 * stream is genuinely a different one.
 */
export function useObservable<T>(
  factory: () => Observable<T>,
  deps: readonly unknown[],
): T | undefined;
export function useObservable<T>(
  factory: () => Observable<T>,
  deps: readonly unknown[],
  initial: T,
): T;
export function useObservable<T>(
  factory: () => Observable<T>,
  deps: readonly unknown[],
  initial?: T,
): T | undefined {
  const [value, setValue] = useState<T | undefined>(initial);

  useEffect(() => {
    const subscription = factory().subscribe(setValue);
    return () => subscription.unsubscribe();
    // The factory is intentionally not a dependency — deps describe when it changes.
    // oxlint-disable-next-line exhaustive-deps
  }, deps);

  return value;
}
