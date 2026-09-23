import { expect, test } from "vitest";
import type { ActionConfig, MapAction, MapMetric, MapObject } from "@mapward/core";
import {
  formPayload,
  matchActions,
  needsForm,
  resolveAction,
  startValues,
  strayErrors,
} from "./actions.ts";
import { keyClashes } from "../../../kernel/clashes.ts";

const action = (address: string, config: ActionConfig = {}): MapAction => ({
  key: address.split("/").at(-1) ?? "",
  address,
  configPath: "/x/config.json",
  layers: [],
  config,
});

const object = (address: string, extra: Partial<MapObject> = {}): MapObject =>
  ({
    address,
    path: "/map",
    name: address,
    isGroup: false,
    props: {},
    layers: [],
    metrics: [],
    directives: [],
    actions: [],
    workflow: [],
    metricGroups: [],
    children: [],
    ...extra,
  }) as unknown as MapObject;

const release = action("mapward://pkg/_actions/release", { label: "Выпустить версию" });
const rerun = action("mapward://pkg/_actions/rerun", {
  inputs: { file: { required: true }, dry: { type: "boolean" } },
});
const pkg = object("mapward://pkg", { actions: [release, rerun] });
const other = object("mapward://other", { actions: [action("mapward://other/_actions/deploy")] });
const map = object("mapward://", { children: [pkg, other] });

test("run — ключ экшона своего объекта или полный адрес любого", () => {
  expect(resolveAction(map, pkg, "release")).toBe(release);
  expect(resolveAction(map, pkg, "mapward://other/_actions/deploy")?.key).toBe("deploy");
  // Ключ ищется только у своего объекта: чужой экшон называют адресом.
  expect(resolveAction(map, pkg, "deploy")).toBeUndefined();
  expect(resolveAction(map, pkg, "mapward://pkg/_actions/nope")).toBeUndefined();
});

test("без формы — когда всё обязательное есть и confirm не просили", () => {
  expect(needsForm(release, {})).toBe(false);
  expect(needsForm(rerun, {})).toBe(true);
  expect(needsForm(rerun, { file: "a.test.ts" })).toBe(false);
  expect(needsForm(action("mapward://a", { confirm: true }), {})).toBe(true);
  // Умолчание заполняет поле так же, как переданное значение.
  expect(
    needsForm(action("mapward://a", { inputs: { x: { required: true, default: 1 } } }), {}),
  ).toBe(false);
});

test("форма начинается с переданного, потом умолчания; флажок — да или нет", () => {
  const inputs = {
    level: { type: "choice" as const, options: ["patch", "minor"], default: "patch" },
    dry: { type: "boolean" as const, default: true },
    note: {},
  };
  expect(startValues(inputs, { level: "minor" })).toEqual({ level: "minor", dry: true, note: "" });
});

test("пустое поле не уходит, неописанное переданное — уходит, чтобы сервер его назвал", () => {
  const inputs = { file: {}, note: {} };
  expect(formPayload(inputs, { file: "a", note: "" }, { typo: 1 })).toEqual({ file: "a", typo: 1 });
  expect(
    strayErrors(inputs, { file: "обязательное поле", typo: "у экшона нет такого поля" }),
  ).toEqual(["typo: у экшона нет такого поля"]);
});

test("поиск — по словам в подписи, ключе и описании", () => {
  expect(matchActions([release, rerun], "")).toEqual([release, rerun]);
  expect(matchActions([release, rerun], "версию выпуст")).toEqual([release]);
  expect(matchActions([release, rerun], "RERUN")).toEqual([rerun]);
});

test("ключ, занятый и метрикой, и экшоном, — ошибка объекта", () => {
  const metrics = [{ key: "release" }, { key: "files" }] as MapMetric[];
  expect(keyClashes(metrics, [release, rerun])).toEqual(["release"]);
});
