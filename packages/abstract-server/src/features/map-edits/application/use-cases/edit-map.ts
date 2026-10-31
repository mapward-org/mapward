import type { MapEditOp, MapEditResult } from "@mapward/core";
import type { FileReader } from "../../../../ports/index.ts";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import type { MapEditsPlugins, MapEditsSource } from "../../ports.ts";
import { mapFiles, planEdit, type FileChange, type Move } from "../../domain/plan.ts";
import { shifted, toSteps, type Step } from "../../domain/steps.ts";
import type { ApplySteps } from "../services/apply-steps.ts";
import { CHECK_TIMEOUT_MS, type CheckTarget } from "../services/check-target.ts";
import type { EditHistory } from "../services/edit-history.ts";
import type { FieldOps } from "../services/field-ops.ts";

/** Посчитанная операция — правки файлов и её ответ, или отказ с подробностями. */
type Planned =
  | {
      changes: FileChange[];
      result: unknown;
      created?: string;
      moves?: Move[];
      copies?: Move[];
    }
  | { error: string; errors?: string[]; current?: unknown };

/**
 * Пачка операций правки карты: интерфейс, агент через MCP и плагины через `ctx.editMap` зовут
 * одно и то же — свои поля, структуру, сырые файлы, проверку. Ответ каждой операции — в
 * `results` по порядку. Операции идут по очереди, каждая считается по свежей модели, в которой уже есть
 * сделанное предыдущими: создать объект и перенести в него другой можно одной пачкой. Отказ любой
 * откатывает всю пачку — на диске не остаётся половины. Записанное модель видит сразу: тронутое
 * перечитывается до ответа.
 */
export class EditMap {
  constructor(
    private readonly map: MapEditsSource,
    private readonly reader: FileReader,
    private readonly apply: ApplySteps,
    private readonly history: EditHistory,
    private readonly fields: FieldOps,
    private readonly checks: CheckTarget,
    private readonly plugins: MapEditsPlugins,
  ) {}

  /** Одна операция по снимку: свои поля и файлы — `FieldOps`, структура — `planEdit`. */
  private async planOne(
    ref: MapRef,
    root: Awaited<ReturnType<MapEditsSource["current"]>>,
    files: ReadonlyMap<string, string>,
    op: MapEditOp,
  ): Promise<Planned> {
    switch (op.op) {
      case "get":
      case "set":
      case "delete":
      case "readFile":
      case "writeFile":
      case "removeFile":
        return this.fields.plan(ref, { root, files }, op);
      case "check":
        return {
          changes: [],
          result: await this.checks.run(ref, root, op.address, op.timeout ?? CHECK_TIMEOUT_MS),
        };
      case "installDeps": {
        const installed = await this.plugins.installDeps(ref, op.plugin);
        return "error" in installed
          ? { error: installed.error }
          : { changes: [], result: { plugin: op.plugin, ...installed } };
      }
      default: {
        const plan = planEdit({ root, files }, op);
        if ("error" in plan) return plan;
        return {
          changes: plan.changes,
          result: plan.created === undefined ? {} : { address: plan.created },
          ...(plan.created === undefined ? {} : { created: plan.created }),
          moves: plan.moves,
          copies: plan.copies,
        };
      }
    }
  }

  async run(ref: MapRef, ops: MapEditOp[]): Promise<MapEditResult> {
    if (ops.length === 0) return { ok: false, error: "Пустая пачка: ни одной операции" };
    const id = this.history.nextId();
    let back: Step[] = [];
    let after = new Map<string, string | undefined>();
    const touched = new Set<string>();
    const created: string[] = [];
    const moves: Move[] = [];
    const copies: Move[] = [];
    const results: unknown[] = [];

    const rollback = async (
      error: string,
      extra: { errors?: string[]; current?: unknown } = {},
    ): Promise<MapEditResult> => {
      if (back.length > 0) await this.apply.run(ref, back, id);
      return {
        ok: false,
        error,
        ...(extra.errors === undefined ? {} : { errors: extra.errors }),
        ...(extra.current === undefined ? {} : { current: extra.current }),
      };
    };

    for (const [index, op] of ops.entries()) {
      const where = ops.length > 1 ? `Операция ${index + 1} (${op.op}): ` : "";
      // oxlint-disable-next-line no-await-in-loop
      const root = await this.map.current(ref);
      const files = new Map<string, string>();
      // oxlint-disable-next-line no-await-in-loop
      await Promise.all(
        mapFiles(root).map(async (path) => {
          const text = await this.reader.read(path);
          if (text !== undefined) files.set(path, text);
        }),
      );

      // oxlint-disable-next-line no-await-in-loop
      const plan = await this.planOne(ref, root, files, op);
      if ("error" in plan) {
        const { error, ...extra } = plan;
        // oxlint-disable-next-line no-await-in-loop
        return rollback(`${where}${error}`, extra);
      }

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
      if (plan.created !== undefined) created.push(plan.created);
      moves.push(...(plan.moves ?? []));
      copies.push(...(plan.copies ?? []));
      results.push(plan.result);
    }

    this.history.save(ref.mapPath, { id, state: "done", back, after, moves });
    return { ok: true, id, touched: [...touched], created, moves, copies, results };
  }
}
