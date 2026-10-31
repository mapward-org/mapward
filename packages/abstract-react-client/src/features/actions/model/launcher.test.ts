import { expect, test } from "vitest";
import type { ActionConfig, MapAction } from "@mapward/core";
import { Launcher, type LaunchRunner } from "./launcher.ts";

const action = (config: ActionConfig): MapAction => ({
  key: "file-delete",
  address: "mapward://pkg/_actions/file-delete",
  configPath: "/x/config.json",
  layers: [],
  config: { label: "Удалить", ...config },
});

function runner(answer: { errors?: Record<string, string> } = {}) {
  const sent: Record<string, unknown>[] = [];
  const run: LaunchRunner = {
    // Схема метода `tag`: метка обязательна, репозиторий задан экшоном.
    form: async () => ({ fields: { name: { type: "string", required: true } } }),
    run: async (_action, inputs) => {
      sent.push(inputs);
      return { id: "1", ...answer } as never;
    },
  };
  return { run, sent };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

const remove = action({
  confirm: "Удалить ${{ inputs.path }}?",
  inputs: { path: { required: true } },
});

test("confirm текстом — вопрос с данными формы, и без «да» ничего не уходит", async () => {
  const { run, sent } = runner();
  const launcher = new Launcher(run);

  launcher.launch(remove, { path: "src/a.ts" });
  expect(launcher.question).toBe("Удалить src/a.ts?");
  expect(sent).toEqual([]);

  launcher.cancel();
  await settled();
  expect(launcher.opened).toBeUndefined();
  expect(sent).toEqual([]);
});

test("«да» на вопрос запускает то, о чём спрашивали", async () => {
  const { run, sent } = runner();
  const launcher = new Launcher(run);

  launcher.launch(remove, { path: "src/a.ts" });
  launcher.confirm();
  await settled();

  expect(sent).toEqual([{ path: "src/a.ts" }]);
  expect(launcher.opened).toBeUndefined();
});

test("незаполненная форма — сначала она, вопрос после неё с вписанным", async () => {
  const { run, sent } = runner();
  const launcher = new Launcher(run);

  launcher.launch(remove, {});
  expect(launcher.question).toBeUndefined();
  expect(launcher.fields.map((field) => field.name)).toEqual(["path"]);

  launcher.change("path", "lib");
  launcher.submit();
  expect(launcher.question).toBe("Удалить lib?");
  expect(sent).toEqual([]);

  launcher.confirm();
  await settled();
  expect(sent).toEqual([{ path: "lib" }]);
});

test("сервер отказал после «да» — назад к форме с ошибками, а не к вопросу", async () => {
  const { run } = runner({ errors: { path: "обязательное поле" } });
  const launcher = new Launcher(run);

  launcher.launch(remove, { path: "x" });
  launcher.confirm();
  await settled();

  expect(launcher.question).toBeUndefined();
  expect(launcher.fields[0]?.error).toBe("обязательное поле");
});

test("без confirm и с полной формой — запуск сразу, как раньше", async () => {
  const { run, sent } = runner();
  const launcher = new Launcher(run);

  launcher.launch(action({ inputs: { path: { required: true } } }), { path: "a" });
  expect(launcher.opened).toBeUndefined();
  await settled();
  expect(sent).toEqual([{ path: "a" }]);
});

test("экшон над методом: форма — схема метода, она приходит от плагина", async () => {
  const { run, sent } = runner();
  const launcher = new Launcher(run);
  const tag = action({ plugin: "/map/_plugins/git", method: "tag", params: { repo: "core" } });

  launcher.launch(tag, {});
  await settled();
  expect(launcher.fields.map((field) => [field.name, field.required])).toEqual([["name", true]]);

  launcher.change("name", "v1");
  launcher.submit();
  await settled();
  expect(sent).toEqual([{ name: "v1" }]);
});

test("своя форма экшона открывается всегда и шлёт свои значения поверх переданных", async () => {
  const { run, sent } = runner();
  const launcher = new Launcher(run);
  const custom = action({
    plugin: "/x/_plugins/tag",
    method: "tag",
    component: "/x/form.tsx",
  });

  // Всё заполнено, вопроса нет — а форма всё равно открыта: автор написал её, чтобы её видели.
  launcher.launch(custom, { name: "v1", repo: "a" });
  await settled();
  expect(launcher.component).toBe("/x/form.tsx");
  const props = launcher.componentProps;
  expect(props?.params).toEqual({ name: "v1" });
  expect(props?.fields).toEqual({ name: { type: "string", required: true } });
  // Пока форма та же — пропсы те же: компонент не перерисовывается зря.
  expect(launcher.componentProps).toBe(props);

  props?.submit({ name: "v2" });
  await settled();
  expect(sent).toEqual([{ name: "v2", repo: "a" }]);
  expect(launcher.opened).toBeUndefined();
});
