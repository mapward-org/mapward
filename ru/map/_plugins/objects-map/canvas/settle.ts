import { catchError, firstValueFrom, of } from "rxjs";
import type { PluginStream } from "@mapward/component";
import type { EditResult } from "../model/ops.ts";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Ответ на правку промисом — так его ждёт холст. У потока берётся первое значение и подписка
 * снимается: правка уже записана, держать её незачем. Отказ потока и поток без ответа — тоже
 * ответ: холст снимает правку, наложенную поверх значения, а не ждёт её вечно.
 */
export function settle(call: PluginStream<EditResult>): Promise<EditResult> {
  return firstValueFrom(
    call.pipe(catchError((error: unknown) => of<EditResult>({ ok: false, error: message(error) }))),
    { defaultValue: { ok: false, error: "плагин закончил правку без ответа" } },
  );
}
