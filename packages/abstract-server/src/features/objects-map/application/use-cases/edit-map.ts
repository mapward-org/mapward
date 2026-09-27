import { editSources, planEdit } from "@mapward/core";
import type { EditResult, MapOp } from "@mapward/core";
import type { FileReader } from "../../../../ports/index.ts";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import type { ObjectsMapSource } from "../../ports.ts";
import { shifted, toSteps, type Step } from "../../domain/steps.ts";
import type { ApplySteps } from "../services/apply-steps.ts";
import type { EditHistory } from "../services/edit-history.ts";

/**
 * Пачка операций правки — решение 0044: холст и агент зовут одно и то же. Операции идут по
 * очереди, каждая считается по свежей модели, в которой уже есть сделанное предыдущими: создать
 * объект и провести к нему стрелку можно одной пачкой. Отказ любой откатывает всю пачку — на
 * диске не остаётся половины.
 */
export class EditMap {
  constructor(
    private readonly map: ObjectsMapSource,
    private readonly reader: FileReader,
    private readonly apply: ApplySteps,
    private readonly history: EditHistory,
  ) {}

  async run(ref: MapRef, ops: MapOp[]): Promise<EditResult> {
    const id = this.history.nextId();
    let back: Step[] = [];
    let after = new Map<string, string | undefined>();
    const touched = new Set<string>();

    const rollback = async (error: string): Promise<EditResult> => {
      if (back.length > 0) await this.apply.run(ref, back, id);
      return { ok: false, error };
    };

    for (const [index, op] of ops.entries()) {
      const where = ops.length > 1 ? `Операция ${index + 1} (${op.op}): ` : "";
      // oxlint-disable-next-line no-await-in-loop
      const root = await this.map.current(ref);
      const files = new Map<string, string>();
      // oxlint-disable-next-line no-await-in-loop
      await Promise.all(
        editSources(root).map(async (path) => {
          const text = await this.reader.read(path);
          if (text !== undefined) files.set(path, text);
        }),
      );

      const plan = planEdit({ root, files }, op);
      // oxlint-disable-next-line no-await-in-loop
      if ("error" in plan) return rollback(`${where}${plan.error}`);

      const steps = toSteps(plan.changes, ref.mapPath, id);
      // oxlint-disable-next-line no-await-in-loop
      const applied = await this.apply.run(ref, steps, id);
      back = [...applied.inverse, ...back];
      for (const step of steps) {
        if (step.kind !== "move") continue;
        after = new Map(
          [...after].map(([path, text]) => [shifted(path, step.from, step.to), text]),
        );
      }
      for (const [path, text] of applied.after) after.set(path, text);
      for (const path of applied.touched) touched.add(path);
      // oxlint-disable-next-line no-await-in-loop
      if (applied.error) return rollback(`${where}${applied.error}`);
    }

    this.history.save(ref.mapPath, { id, state: "done", back, after });
    return { ok: true, id, touched: [...touched] };
  }
}
