import type { EditResult } from "@mapward/core";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import type { ApplySteps } from "../services/apply-steps.ts";
import type { EditHistory } from "../services/edit-history.ts";

/**
 * Отмена и повтор пачки — решение 0044. Одно и то же действие в две стороны: применить обратные
 * шаги и запомнить обратные к ним. Файл, который с тех пор поменяли мимо правки — агент, git,
 * человек в редакторе, — не затирается: отмена отказывает и называет его.
 */
export class ToggleEdit {
  constructor(
    private readonly apply: ApplySteps,
    private readonly history: EditHistory,
    /** Какой пачка должна быть, чтобы это действие было к ней применимо. */
    private readonly from: "done" | "undone",
  ) {}

  async run(ref: MapRef, id: string): Promise<EditResult> {
    const batch = this.history.find(ref.mapPath, id);
    if (!batch) {
      return {
        ok: false,
        error: `Пачки ${id} нет: номер чужой или сервер перезапускали — откатывай git`,
      };
    }
    if (batch.state !== this.from) {
      return {
        ok: false,
        error: this.from === "done" ? `Пачка ${id} уже отменена` : `Пачка ${id} не отменена`,
      };
    }

    const drifted = await this.apply.drifted(batch.after);
    if (drifted.length > 0) {
      return {
        ok: false,
        error: `Файлы поменяли мимо правки, не трогаю: ${drifted.join(", ")}`,
      };
    }

    const applied = await this.apply.run(ref, batch.back, id);
    if (applied.error) {
      // Половина отката хуже никакого: сделанное возвращается, пачка остаётся какой была.
      await this.apply.run(ref, applied.inverse, id);
      return { ok: false, error: applied.error };
    }

    this.history.save(ref.mapPath, {
      id,
      state: this.from === "done" ? "undone" : "done",
      back: applied.inverse,
      after: applied.after,
    });
    return { ok: true, id, touched: applied.touched };
  }
}
