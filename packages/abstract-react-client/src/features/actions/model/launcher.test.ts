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
