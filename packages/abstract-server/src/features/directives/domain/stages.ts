import type { MapStage } from "@mapward/core";
import { frontmatter } from "../../../lib/frontmatter.ts";

/** Этап зовут по имени; без имени берётся первый по порядку. Регистр не важен. */
export const pickStage = (stages: MapStage[], wanted: string | undefined): MapStage | undefined =>
  wanted === undefined
    ? stages[0]
    : stages.find((stage) => stage.name.toLowerCase() === wanted.trim().toLowerCase());

/** Тело файла этапа без frontmatter: в промпт едет промпт, а не его настройки. */
export const stageBody = (text: string) => frontmatter(text).body;

/** Этапов с таким именем нет — ошибка с перечнем тех, что есть. */
export const noStage = (stages: MapStage[], wanted: string | undefined) =>
  new Error(
    `У объекта нет этапа ${String(wanted)}. Есть: ${
      stages.map((entry) => `«${entry.name}»`).join(", ") || "ни одного"
    }.`,
  );
