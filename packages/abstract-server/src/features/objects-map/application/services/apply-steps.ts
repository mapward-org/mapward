import type { FileMover, FileReader, FileWriter } from "../../../../ports/index.ts";
import type { MapRef } from "../../../../kernel/map-ref.ts";
import { dirname, join } from "../../../../lib/path.ts";
import type { ObjectsMapSource } from "../../ports.ts";
import { inside, shifted, trashOf, type Step } from "../../domain/steps.ts";

/**
 * Итог применённых шагов: как их откатить и какими файлы стали. По второму отмена узнаёт,
 * не поменяли ли их мимо неё, — тогда она отказывает, а не затирает чужое.
 */
export type Applied = {
  /** Обратные шаги, уже в порядке отката. */
  inverse: Step[];
  /** Записанные файлы и их текст после шагов; `undefined` — файла после шагов нет. */
  after: Map<string, string | undefined>;
  /** Что тронуто: для отчёта и для перечитывания модели. */
  touched: string[];
  /** Шаг упал посередине: сделанное до него описано выше и откатывается как обычно. */
  error?: string;
};

/**
 * Применяет шаги к диску и записывает обратные — решение 0044. Каждый шаг сразу знает свою
 * отмену: запись помнит прежний текст, перенос — откуда, а файл, которого не было, отменяется
 * удалением. Пустая папка после такого удаления уезжает в корзину: иначе на карте осталась бы
 * полка на месте отменённого объекта.
 */
export class ApplySteps {
  /** Номер для пустых папок в корзине: сквозной, чтобы откат отката не наткнулся на свою же. */
  private spare = 0;

  constructor(
    private readonly reader: FileReader,
    private readonly writer: FileWriter,
    private readonly mover: FileMover | undefined,
    private readonly map: ObjectsMapSource,
  ) {}

  async run(ref: MapRef, steps: Step[], id: string): Promise<Applied> {
    const inverse: Step[] = [];
    const after = new Map<string, string | undefined>();
    const touched: string[] = [];

    const move = async (from: string, to: string) => {
      if (!this.mover) throw new Error("Хост не умеет переносить папки — правку не применить");
      await this.mover.move(from, to);
      // Снимок: правка карты под обходом разбудила бы перенесённые ключи ещё раз.
      for (const [path, text] of Array.from(after)) {
        if (!inside(path, from)) continue;
        after.delete(path);
        after.set(shifted(path, from, to), text);
      }
    };

    let error: string | undefined;
    try {
      for (const step of steps) {
        if (step.kind === "write") {
          // oxlint-disable-next-line no-await-in-loop
          const before = await this.reader.read(step.path);
          // oxlint-disable-next-line no-await-in-loop
          await this.writer.write(step.path, step.text);
          inverse.unshift(
            before === undefined
              ? { kind: "delete", path: step.path }
              : { kind: "write", path: step.path, text: before },
          );
          after.set(step.path, step.text);
          touched.push(step.path);
          continue;
        }

        if (step.kind === "delete") {
          // oxlint-disable-next-line no-await-in-loop
          const before = await this.reader.read(step.path);
          // oxlint-disable-next-line no-await-in-loop
          await this.writer.remove(step.path);
          after.set(step.path, undefined);
          touched.push(step.path);
          // Откат идёт с головы списка: сперва вернуть папку, потом записать в неё файл.
          if (before !== undefined)
            inverse.unshift({ kind: "write", path: step.path, text: before });
          const folder = dirname(step.path);
          // oxlint-disable-next-line no-await-in-loop
          const left = await this.reader.list(folder);
          if (left.length === 0) {
            this.spare += 1;
            const parked = join(trashOf(ref.mapPath, id), `.empty-${this.spare}`);
            // oxlint-disable-next-line no-await-in-loop
            await move(folder, parked);
            inverse.unshift({ kind: "move", from: parked, to: folder });
            touched.push(folder);
          }
          continue;
        }

        // oxlint-disable-next-line no-await-in-loop
        await move(step.from, step.to);
        inverse.unshift({ kind: "move", from: step.to, to: step.from });
        touched.push(step.from, step.to);
      }
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    // Даже упавшее посередине перечитывается: модель должна видеть диск, каким он стал.
    await this.map.refresh(touched);

    return { inverse, after, touched, ...(error === undefined ? {} : { error }) };
  }

  /** Какие из записанных файлов с тех пор поменяли мимо — отмена по ним отказывает. */
  async drifted(after: Map<string, string | undefined>): Promise<string[]> {
    const changed: string[] = [];
    for (const [path, text] of after) {
      // oxlint-disable-next-line no-await-in-loop
      if ((await this.reader.read(path)) !== text) changed.push(path);
    }
    return changed;
  }
}
