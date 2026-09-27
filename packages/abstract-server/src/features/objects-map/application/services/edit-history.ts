import type { Step } from "../../domain/steps.ts";

/**
 * Пачка правок, которую можно отменить и повторить. `back` — шаги, которые переводят её в
 * другое состояние: у сделанной это откат, у отменённой — повтор.
 */
export type Batch = {
  id: string;
  state: "done" | "undone";
  back: Step[];
  /** Какими пачка оставила файлы — по этому отмена видит правки мимо неё. */
  after: Map<string, string | undefined>;
};

/**
 * Пачки по номеру — решение 0044. Сервер помнит их в памяти и не решает, чья отмена следующая:
 * стек держит тот, кто звал, — у холста свой, у агента свой. Перезапуск сервера пачки стирает,
 * и тогда отмена говорит, что пачки нет, а откатывают git.
 */
export class EditHistory {
  private counter = 0;
  private readonly batches = new Map<string, Batch>();

  nextId(): string {
    this.counter += 1;
    return String(this.counter);
  }

  save(mapPath: string, batch: Batch): void {
    this.batches.set(`${mapPath}|${batch.id}`, batch);
  }

  find(mapPath: string, id: string): Batch | undefined {
    return this.batches.get(`${mapPath}|${id}`);
  }
}
