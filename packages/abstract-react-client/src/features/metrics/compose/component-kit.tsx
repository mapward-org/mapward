import type * as Kit from "@mapward/component";
import type { ReactNode } from "react";
import {
  useAction,
  useMutation,
  useNavigation,
  usePlugin,
  useQuery,
  useStream,
  useViewState,
} from "../plugin-kit.ts";
import { useMetricsPort } from "../ports.tsx";

/**
 * Набор `@mapward/component` — решение 0037: API окна, которым компонент говорит с платформой.
 * Готовых кирпичей здесь нет — они код плагина `views` и собираются в компонент вместе с ним.
 */

/**
 * Карточка объекта — та же, что у пункта с `object`: её рисует фича карточки, сетка даёт её портом.
 * Холст плагина `objects-map` ставит ею узлы с полным превью.
 */
function ObjectCard(props: {
  object: string;
  group?: string;
  width?: string | number;
  maxHeight?: string | number;
  actions?: ReactNode;
  draggable?: boolean;
}) {
  const port = useMetricsPort();
  return (
    <port.Card
      item={{
        object: props.object,
        ...(props.group === undefined ? {} : { group: props.group }),
        ...(props.width === undefined ? {} : { width: props.width }),
        ...(props.maxHeight === undefined ? {} : { maxHeight: props.maxHeight }),
      }}
      actions={props.actions}
      draggable={props.draggable}
    />
  );
}

/**
 * Что получает `import … from "@mapward/component"`. Тип набора берётся из опубликованного пакета:
 * разойдутся — не соберётся клиент, а не сломается чужой компонент.
 */
export const ComponentKit = {
  // Типы методов берутся из плагина автора — клиенту они неизвестны, поэтому приведение.
  usePlugin: usePlugin as typeof Kit.usePlugin,
  useQuery,
  useStream,
  useMutation,
  useNavigation,
  useViewState,
  useAction,
  ObjectCard,
} satisfies { [K in keyof typeof Kit]: (typeof Kit)[K] };
