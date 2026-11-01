import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { afterAll, beforeAll, expect, test } from "vitest";
import type { PluginDefinition } from "@mapward/plugin";
import agent from "../agent/index.ts";
import files from "../files/index.ts";
import { plugin as running } from "../harness.ts";
import shell from "./index.ts";

/**
 * `shell` и `agent` тем же рантаймом, что в процессе, против поддельного канала: платформа здесь —
 * тест. Команды настоящие (node), агент — подставной скрипт вместо `claude`: он печатает события
 * так же, как `claude --output-format stream-json`.
 */

let dir = "";
const plugin = (definition: PluginDefinition, peers: Record<string, PluginDefinition> = {}) =>
  running(dir, definition, peers);
const slash = (path: string) => path.replaceAll("\\", "/");

beforeAll(async () => {
  dir = slash(await mkdtemp(join(tmpdir(), "mapward-shell-")));
  // Подставной агент: промпт из stdin и флаги — в ответ; инструмент и текст — ходом.
  await writeFile(
    join(dir, "fake-claude.mjs"),
    [
      'let prompt = "";',
      'process.stdin.on("data", (chunk) => (prompt += chunk));',
      'process.stdin.on("end", () => {',
      "  const say = (event) => console.log(JSON.stringify(event));",
      '  say({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "a.ts" } }] } });',
      '  say({ type: "assistant", message: { content: [{ type: "text", text: "думаю" }] } });',
      '  say({ type: "result", result: `ответ: ${prompt} | ${process.argv.slice(2).join(" ")} | ${process.env.MAPWARD_INPUT_TOPIC ?? ""}` });',
      "});",
    ].join("\n"),
    "utf8",
  );
  process.env.MAPWARD_AGENT_COMMAND = `node "${dir}/fake-claude.mjs"`;
});

afterAll(async () => {
  delete process.env.MAPWARD_AGENT_COMMAND;
  // Снятая команда освобождает папку не сразу: taskkill работает асинхронно.
  await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const lines = (values: unknown[], progress: string) =>
  values
    .filter((value) => (value as { progress?: string }).progress === progress)
    .map((value) => (value as { text: string }).text);

test("shell.run: output line by line, the form in the command, the env and the stdin", async () => {
  const { call } = plugin(shell);

  const outcome = await call("run", {
    command:
      "node -e \"process.stdin.on('data', (d) => console.log('вход ' + d)); console.log('${{ inputs.level }}'); console.log(process.env.MAPWARD_INPUT_LEVEL); console.error('ход')\"",
    inputs: { level: "minor" },
  });

  expect(outcome.error).toBeUndefined();
  expect(lines(outcome.values, "out")).toEqual(["minor", "minor", 'вход {"level":"minor"}']);
  expect(lines(outcome.values, "log")).toEqual(["ход"]);
  expect(outcome.values.at(-1)).toEqual({ code: 0 });
});

test("shell.run: a non-zero exit is an error with the stderr tail; the timeout stops it", async () => {
  const { call } = plugin(shell);

  const failed = await call("run", {
    command: "node -e \"console.error('сломалось'); process.exit(3)\"",
  });
  expect(failed.error).toBe("сломалось");

  const slow = await call("run", {
    command: 'node -e "setTimeout(() => {}, 20000)"',
    timeout: 200,
  });
  expect(slow.error).toBe("время вышло, предел 200 мс");
});

/** Жив ли процесс: сигнал 0 ничего не шлёт, а только спрашивает. */
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("shell.run: cancelling the call kills the command with its children", async () => {
  const { stream } = plugin(shell);
  // Команда называет себя и ждёт: снять её может только отмена.
  const pid = await new Promise<number>((resolve) => {
    const { cancel } = stream(
      "run",
      { command: 'node -e "console.log(process.pid); setTimeout(() => {}, 20000)"' },
      {
        next: (value) => {
          cancel();
          resolve(Number((value as { text: string }).text));
        },
        error: () => {},
        complete: () => {},
      },
    );
  });

  const dead = await new Promise<boolean>((resolve) => {
    const started = Date.now();
    const check = () => {
      if (!alive(pid)) resolve(true);
      else if (Date.now() - started > 10_000) resolve(false);
      else setTimeout(check, 50);
    };
    check();
  });
  expect(dead).toBe(true);
});

test("agent.run: the move is streamed, the answer comes last; permissions become flags", async () => {
  const { call } = plugin(agent);

  const outcome = await call("run", {
    prompt: "расскажи про ${{ inputs.topic }}",
    permissions: ["Read", "Bash(git add:*)"],
    inputs: { topic: "карты" },
  });

  expect(outcome.error).toBeUndefined();
  expect(lines(outcome.values, "log")).toEqual(["→ Read a.ts", "думаю"]);
  const [answer] = lines(outcome.values, "out");
  // Промпт подставлен и несёт форму в конце; разрешения дошли флагами; форма — и переменной.
  expect(answer).toContain("ответ: расскажи про карты");
  expect(answer).toContain('Данные формы, с которыми запустили экшон: {"topic":"карты"}');
  expect(answer).toContain("--allowedTools Read Bash(git add:*)");
  expect(answer).toContain("| карты");
  expect(outcome.values.at(-1)).toEqual({ answer });
});

test("shell.steps: steps one by one, a prompt step goes to agent next door", async () => {
  const { call } = plugin(shell, { agent });

  const outcome = await call("steps", {
    steps: [
      { kind: "script", name: "раз", command: 'node -e "console.log(1)"' },
      { kind: "prompt", name: "два", prompt: "привет", permissions: "bypass" },
    ],
  });

  expect(outcome.error).toBeUndefined();
  const shown = outcome.values.map((value) => {
    const message = value as { progress: string; name?: string; text?: string };
    return message.progress === "step"
      ? `шаг ${message.name}`
      : `${message.progress} ${message.text}`;
  });
  expect(shown[0]).toBe("шаг раз");
  expect(shown[1]).toBe("out 1");
  expect(shown[2]).toBe("шаг два");
  expect(shown.at(-1)).toContain("--dangerously-skip-permissions");

  const unknown = await call("steps", { steps: [{ kind: "deploy" }] });
  // Вид шага — по схеме метода: незнакомый отвергается ещё до запуска.
  expect(unknown.error).toMatch(/^аргументы steps не по схеме: \/steps\/0\/kind/);
  const failed = await call("steps", {
    steps: [
      { kind: "script", command: 'node -e "process.exit(1)"' },
      { kind: "script", command: 'node -e "console.log(2)"' },
    ],
  });
  // Упал один — остальные не идут.
  expect(failed.error).toBe("команда вернула 1");
  expect(lines(failed.values, "out")).toEqual([]);
});

/** Поток до условия: значения копятся, пока `until` не скажет «хватит», дальше — отписка. */
function until(
  stream: ReturnType<typeof plugin>["stream"],
  method: string,
  args: unknown,
  enough: (values: unknown[]) => boolean,
  act?: (values: unknown[]) => void,
) {
  return new Promise<unknown[]>((resolve, reject) => {
    const values: unknown[] = [];
    const { cancel } = stream(method, args, {
      next: (value) => {
        values.push(value);
        act?.(values);
        if (enough(values)) {
          cancel();
          resolve(values);
        }
      },
      error: (error) => reject(new Error(error)),
      complete: () => resolve(values),
    });
  });
}

test("shell.json: the output is parsed as json, plain text becomes { text }, a failure is an error", async () => {
  const { call } = plugin(shell);

  const parsed = await call("json", {
    command: 'node -e "console.log(JSON.stringify({ items: [{ label: process.env.WHO }] }))"',
    env: { WHO: "core" },
  });
  expect(parsed).toEqual({ values: [{ items: [{ label: "core" }] }] });

  const text = await call("json", { command: "node -e \"console.log(1 + 1, 'шт')\"" });
  expect(text.values).toEqual([{ text: "2 шт" }]);

  const failed = await call("json", {
    command: "node -e \"console.error('нет'); process.exit(2)\"",
  });
  expect(failed.error).toBe("нет");
});

test("shell.json: watch reruns the command while subscribed, files outside the globs do not", async () => {
  const { stream } = plugin(shell);
  const watched = `${dir}/watched`;
  await mkdir(watched, { recursive: true });
  await writeFile(`${watched}/a.md`, "раз", "utf8");

  const values = await until(
    stream,
    "json",
    {
      command: `node -e "console.log(JSON.stringify(require('fs').readdirSync('${watched}').sort()))"`,
      watch: { include: ["watched/**/*.md"], debounce: 50 },
    },
    (seen) => seen.length === 2,
    (seen) => {
      if (seen.length !== 1) return;
      // Мимо глобов — тишина; подходящий файл — новый запуск.
      void writeFile(`${watched}/skip.txt`, "мимо", "utf8").then(() =>
        setTimeout(() => void writeFile(`${watched}/b.md`, "два", "utf8"), 300),
      );
    },
  );
  expect(values).toEqual([["a.md"], ["a.md", "b.md", "skip.txt"]]);
}, 20_000);

test("shell.json: from pipes another method into the command, every new value reruns it", async () => {
  const { stream } = plugin(shell, { files });
  const folder = `${dir}/piped`;
  await mkdir(folder, { recursive: true });
  await writeFile(`${folder}/one.md`, "1", "utf8");

  const values = await until(
    stream,
    "json",
    {
      // Трансформ прежнего вида: вход — дерево files.tree в stdin, выход — значение метрики.
      command:
        "node -e \"let s='';process.stdin.on('data',(d)=>s+=d).on('end',()=>console.log(JSON.stringify({ count: JSON.parse(s).children.length })))\"",
      from: { plugin: "../files", method: "tree", params: { path: folder } },
    },
    (seen) => seen.length === 2,
    (seen) => {
      if (seen.length === 1) void writeFile(`${folder}/two.md`, "2", "utf8");
    },
  );
  expect(values).toEqual([{ count: 1 }, { count: 2 }]);
}, 20_000);

test("agent.ask: the saved answer without asking; refresh asks, saves and tells the watchers", async () => {
  // Агент отвечает json-ом в обёртке, как любит: в ответе — хвост промпта с подсказкой формы.
  await writeFile(
    join(dir, "fake-json.mjs"),
    [
      'let prompt = "";',
      'process.stdin.on("data", (chunk) => (prompt += chunk));',
      'process.stdin.on("end", () => {',
      "  const tail = prompt.split(String.fromCharCode(10)).at(-1);",
      '  const answer = "вот:" + String.fromCharCode(10) + "```json" + String.fromCharCode(10) + JSON.stringify({ items: [{ label: "найдено", description: tail }] }) + String.fromCharCode(10) + "```";',
      '  console.log(JSON.stringify({ type: "result", result: answer }));',
      "});",
    ].join("\n"),
    "utf8",
  );
  const before = process.env.MAPWARD_AGENT_COMMAND;
  process.env.MAPWARD_AGENT_COMMAND = `node "${dir}/fake-json.mjs"`;
  try {
    const { call, stream } = plugin(agent);
    const cache = `${dir}/objects/core/_metrics/drift/answer.json`;
    const args = { prompt: "найди расхождения", shape: "list", cache };

    // Не спрашивали — так и говорится; нового вопроса ask не задаёт.
    expect((await until(stream, "ask", args, (seen) => seen.length === 1))[0]).toEqual({
      asked: false,
    });

    // Тот, кто смотрит, видит «спрашиваю» и новый ответ — кнопку нажимал не он.
    // Нажимаем, когда смотрящий уже увидел прежний ответ: иначе первым он увидит сразу `busy`.
    let looking: (() => void) | undefined;
    const looked = new Promise<void>((resolve) => (looking = resolve));
    const watching = until(
      stream,
      "ask",
      args,
      (seen) => seen.some((value) => (value as { asked?: boolean }).asked === true),
      (seen) => {
        if (seen.length === 1) looking?.();
      },
    );
    await looked;
    const refreshed = await call("refresh", args);
    expect(refreshed.error).toBeUndefined();
    const answer = refreshed.values.at(-1) as { asked: true; updatedAt: string; data: unknown };
    expect(answer.data).toEqual({
      items: [
        {
          label: "найдено",
          description: expect.stringContaining("Ответь только json такой формы") as unknown,
        },
      ],
    });
    const seen = await watching;
    expect(seen[0]).toEqual({ asked: false });
    expect(seen).toContainEqual({ asked: false, busy: true });
    expect(seen.at(-1)).toEqual(answer);

    // Ответ лёг файлом рядом с объектом и отдаётся первым значением без вопроса.
    const saved = JSON.parse(await readFile(cache, "utf8")) as { updatedAt: string };
    expect(saved.updatedAt).toBe(answer.updatedAt);
    const again = await until(stream, "ask", args, (values) => values.length === 1);
    expect(again[0]).toEqual({ asked: true, updatedAt: answer.updatedAt, data: answer.data });
  } finally {
    process.env.MAPWARD_AGENT_COMMAND = before;
  }
}, 20_000);
