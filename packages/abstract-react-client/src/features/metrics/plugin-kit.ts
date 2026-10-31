import { useLocalStore } from "../../lib/store/use-local-store.ts";
import { useWatch } from "../../lib/store/use-watch.ts";
import { MutationStore, QueryStore, StreamStore } from "./model/plugin-calls.ts";
import type { PluginStream } from "./pure-model/plugin-stream.ts";
import { callId, type CallKey } from "./pure-model/call-key.ts";
import type { ActionHandle, Navigate } from "@mapward/component";
import { useViewStates } from "../../services/state/ports.tsx";
import {
  useKit,
  useMetricsPort,
  useNavigationPort,
  usePluginKit,
  type PluginKit,
} from "./ports.tsx";

/**
 * Хуки компонента метрики — то, что `@mapward/component` отдаёт под именами `usePlugin`,
 * `useQuery`, `useStream`, `useMutation`, `useNavigation`, `useViewState`, `useAction`. Состояние
 * держат сторы на потоках, и хук сам подписывает на свой стор компонент, который его позвал:
 * автор пишет обычную функцию.
 */

type Api = Record<string, (args?: unknown) => PluginStream>;

/** Клиент плагина один на ячейку и путь: зависимости хуков на нём не пересоздаются. */
const apis = new WeakMap<PluginKit, Map<string, Api>>();

export function usePlugin(path: string): Api {
  const kit = usePluginKit();
  const plugin = kit.resolve(path);
  let known = apis.get(kit);
  if (!known) {
    known = new Map();
    apis.set(kit, known);
  }
  let api = known.get(plugin);
  if (!api) {
    // Метод — любое имя: какие есть, знает плагин, и неизвестное он отвергнет сам.
    api = new Proxy({} as Api, {
      get: (_target, method) =>
        typeof method === "string"
          ? (args?: unknown) => kit.call(plugin, method, args ?? {})
          : undefined,
    });
    known.set(plugin, api);
  }
  return api;
}

/**
 * Запрос по ключу — как `queryKey` в react-query: ключ — это и зависимости (поменялся — новый
 * запрос), и место в памяти вида. Вернулся компонент с тем же ключом — начинает с прошлого ответа.
 */
export function useQuery<T>(key: CallKey, query: () => PluginStream<T>) {
  const memory = useMetricsPort().calls;
  const id = callId(key);
  const store = useLocalStore(() => new QueryStore(query, memory.slot<T>(id)), [id, memory]);
  useWatch(store);
  return store;
}

export function useStream<T>(key: CallKey, stream: () => PluginStream<T>) {
  const memory = useMetricsPort().calls;
  const id = callId(key);
  const store = useLocalStore(() => new StreamStore(stream, memory.slot<T>(id)), [id, memory]);
  useWatch(store);
  return store;
}

export function useMutation<A, T>(mutate: (args: A) => PluginStream<T>) {
  const store = useLocalStore(() => new MutationStore(mutate), []);
  useWatch(store);
  return store;
}

/**
 * Открыть ссылку, как любая ссылка карты: через плагин `navigation`, объект — переходом экрана.
 * Функция одна на сетку: в `deps` и `onClick` её можно отдавать как есть.
 */
export function useNavigation(): Navigate {
  const navigation = useNavigationPort();
  if (!navigation) throw new Error("useNavigation работает только в сетке метрик карты");
  return navigation.open;
}

/**
 * Настройка смотрящего — то же состояние вида, где карта помнит свёрнутые метрики и раскрытые
 * папки: у человека, в хранилище редактора, а не в карте. `expanded` — каким ключ бывает, когда
 * раскрыто всё: его отдаёт снимок метрики с `expand: "all"`.
 */
export function useViewState<T>(
  key: string,
  initial: T,
  options?: { expanded?: T },
): [T, (value: T) => void] {
  const expanded = options && "expanded" in options ? { value: options.expanded as T } : undefined;
  const slot = useViewStates().slot(key, initial, expanded);
  useWatch(slot);
  return [slot.value, (value) => slot.set(value)];
}

/**
 * Экшон по ключу объекта ячейки или по адресу — решение 0038. Находят, запускают и считают
 * прогоны экшоны (порт метрик); компонент подписан на них и на объект-владелец, пока тот в пути.
 */
export function useAction(action: string, inputs?: Record<string, unknown>): ActionHandle {
  const actions = useMetricsPort().actions;
  const object = useKit().object;
  useWatch(actions, actions.source(action));
  if (!object) throw new Error("useAction работает только в метрике и раскладке карты");
  return actions.handle(object, inputs === undefined ? { run: action } : { run: action, inputs });
}
