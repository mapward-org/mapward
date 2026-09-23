import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { dataDeclaration, DisplaySchema, type MapServer } from "@mapward/abstract-server";
import { findMetricOwner, type ResolvedMap } from "@mapward/core";
import type { createPorts } from "./ports.ts";

/**
 * `mapward display check` — решение 0037: работает ли дисплей-компонент, одной командой.
 *
 * Проверка типов живёт здесь, а не в сборке на карте: TypeScript весит мегабайты и медленный,
 * тащить его в расширение и гонять на каждое сохранение незачем. Агенту хватает команды после
 * правки — поэтому и вывод строками «файл:строка: что не так».
 */
export async function displayCheck(
  ports: ReturnType<typeof createPorts>,
  server: MapServer,
  map: ResolvedMap,
  address: string,
): Promise<boolean> {
  const tree = await server.getMap(map);
  const found = findMetricOwner(tree, address);
  if (!found) throw new Error(`метрика ${address} не найдена`);
  const display = found.metric.config.display;
  const component = display?.component;
  if (display?.kind !== "component" || !component) {
    throw new Error(`у метрики ${address} дисплей не component или не задан display.component`);
  }

  let ok = true;
  const fail = (title: string, lines: string[]) => {
    ok = false;
    console.log(`✗ ${title}`);
    for (const line of lines) console.log(`  ${line}`);
  };

  // 1. Тип данных по схеме — рядом с компонентом, чтобы `DisplayProps<Data>` знал форму.
  const { schema, error } = await new DisplaySchema(ports.files).read(display);
  if (error) fail("схема", [error]);
  const declaration = join(dirname(component), "display.data.d.ts");
  if (schema !== undefined) {
    await ports.files.write(declaration.replaceAll("\\", "/"), dataDeclaration(schema));
    console.log(`✓ тип данных: ${declaration}`);
  } else if (!error) {
    console.log("· схемы нет — тип данных не пишется, данные не проверяются");
  }

  // 2. Типы компонента.
  const tsc = await findTsc(dirname(component), map.basePath);
  if (!tsc) {
    console.log(
      "· TypeScript не найден в node_modules от компонента вверх и в корне проекта — типы не проверены",
    );
  } else {
    const flags = [
      "--noEmit",
      "--strict",
      "--skipLibCheck",
      "--jsx",
      "react-jsx",
      "--module",
      "preserve",
      "--moduleResolution",
      "bundler",
      "--target",
      "es2022",
      "--lib",
      "es2023,dom",
      "--allowImportingTsExtensions",
      "--pretty",
      "false",
    ];
    // Флаги заданы здесь, а `tsconfig.json` проекта не читается: он про сборку проекта, а не
    // про компонент. TypeScript 7 при файле в командной строке и `tsconfig.json` в папке
    // запуска отказывается работать (TS5112) — тогда повтор с `--ignoreConfig`, которого
    // старые версии не знают.
    const cwd = dirname(component);
    let result = await run(tsc, [...flags, component], cwd);
    if (result.output.includes("TS5112")) {
      result = await run(tsc, [...flags, "--ignoreConfig", component], cwd);
    }
    if (result.code === 0) console.log("✓ типы");
    else fail("типы", result.output.trim().split(/\r?\n/));
  }

  // 3. Сборка — та же, что на карте.
  const build = await server.buildDisplay({ ...map, metric: address });
  if (build.errors && build.errors.length > 0) fail("сборка", build.errors);
  else
    console.log(
      `✓ сборка: ${build.code?.length ?? 0} байт кода, ${build.css?.length ?? 0} байт css`,
    );

  // 4. Последнее значение против схемы — без прогона: собирать метрику здесь незачем.
  const values = await server.readMetrics(map, found.object);
  const value = values[address];
  if (!value?.collected)
    console.log(
      "· собранного значения нет — не проверено; без collectorsCache оно живёт только в памяти карты",
    );
  else if (value.invalid && value.invalid.length > 0) fail("данные не прошли схему", value.invalid);
  else if (schema !== undefined) console.log("✓ данные проходят схему");

  return ok;
}

/** `tsc` проекта: от компонента вверх, потом корень проекта — как и пакеты сборки. */
async function findTsc(from: string, basePath: string): Promise<string | undefined> {
  const name = process.platform === "win32" ? "tsc.cmd" : "tsc";
  const dirs: string[] = [];
  let dir = from;
  for (;;) {
    dirs.push(join(dir, "node_modules", ".bin", name));
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  dirs.push(join(basePath, "node_modules", ".bin", name));
  for (const candidate of dirs) {
    try {
      // oxlint-disable-next-line no-await-in-loop
      await access(candidate);
      return candidate;
    } catch {
      // дальше
    }
  }
  return undefined;
}

function run(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    // `.cmd` на Windows запускается только оболочкой; пути в кавычках — в них бывают пробелы.
    const shell = process.platform === "win32";
    const child = spawn(
      shell ? `"${command}"` : command,
      shell ? args.map((arg) => `"${arg}"`) : args,
      { cwd, shell, windowsHide: true },
    );
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, output }));
  });
}
