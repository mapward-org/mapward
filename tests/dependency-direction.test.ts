import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";

/**
 * Инвариант решения 0014: зависимости идут в одну сторону. `core` не знает никого, клиент не
 * знает сервера, пакет не знает приложений. В диффе один удобный импорт выглядит безобидно —
 * поэтому проверяет тест, а не ревью.
 */
const ALLOWED: Record<string, string[]> = {
  "@mapward/core": [],
  // Файлы потоками с точечной подпиской: не знает ни node, ни карты, среда приходит портами.
  // Им живут модель карты на сервере и плагины — через `@mapward/plugin`, который его встраивает.
  "@mapward/vfs": [],
  // Текст инструмента, который едет вместе с ним: не зависит ни от кого, и зависеть не от чего.
  "@mapward/docs": [],
  // Серверная часть плагина: публикуется для чужих проектов, как API окна, и не знает никого.
  // Сервер берёт её протокол и рантайм: собранный пакет едет в сборку каждого плагина текстом.
  // Модель карты пакет встраивает в свою сборку — см. INLINED.
  "@mapward/plugin": [],
  // Исходники встроенных плагинов — текстом, как доки: пакет не знает никого, а сервер копирует
  // их в карту.
  "@mapward/plugins": [],
  "@mapward/abstract-server": [
    "@mapward/core",
    "@mapward/docs",
    "@mapward/plugin",
    "@mapward/plugins",
    "@mapward/vfs",
  ],
  // API окна для компонента метрики (решение 0037): типы публикуются для чужих проектов, поэтому
  // не знают никого из своих; клиент берёт их, чтобы типы и то, что он подменяет, не разъехались.
  "@mapward/component": [],
  "@mapward/abstract-react-client": ["@mapward/core", "@mapward/component"],
};

/**
 * Что пакет встраивает в свою сборку целиком: свой пакет только на время сборки
 * (`devDependencies`), а снаружи собранный файл не зависит ни от кого. `@mapward/plugin` везёт
 * в сборку каждого плагина рантайм с протоколом, а ему нужны типы и помощники модели карты; у
 * плагина в карте `node_modules` нет, поэтому `@mapward/core` едет внутри, а с ним и
 * `@mapward/vfs` — файлы потоками для `createVfs`. Типы модели в объявлениях пакета остаются
 * ссылкой на `@mapward/core`.
 */
const INLINED: Record<string, { deps: string[]; bundle: string }> = {
  "@mapward/plugin": {
    deps: ["@mapward/core", "@mapward/vfs"],
    bundle: "packages/plugin/dist/index.mjs",
  },
};

async function manifest(dir: string): Promise<{ name: string; deps: string[]; devDeps: string[] }> {
  const raw = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")) as {
    name: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return {
    name: raw.name,
    deps: Object.keys(raw.dependencies ?? {}),
    devDeps: Object.keys(raw.devDependencies ?? {}),
  };
}

test("packages depend in one direction only", async () => {
  const entries = await readdir("packages", { withFileTypes: true });
  const packages = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => manifest(path.join("packages", entry.name))),
  );

  expect(packages.length).toBeGreaterThan(0);

  for (const pkg of packages) {
    const allowed = ALLOWED[pkg.name];
    expect(allowed, `нет правила для ${pkg.name}`).toBeDefined();
    const ours = pkg.deps.filter((dep) => dep.startsWith("@mapward/"));
    expect(ours.toSorted(), pkg.name).toEqual((allowed ?? []).toSorted());
  }
});

test("what a package inlines is a build-time dependency, and its bundle imports none of ours", async () => {
  for (const [name, rule] of Object.entries(INLINED)) {
    const dir = path.join("packages", name.replace("@mapward/", ""));
    const pkg = await manifest(dir);
    const ours = pkg.devDeps.filter((dep) => dep.startsWith("@mapward/"));
    expect(ours.toSorted(), name).toEqual(rule.deps.toSorted());
    const bundle = await readFile(rule.bundle, "utf8").catch(() => {
      throw new Error(`${rule.bundle} нет — соберите ${name}: pnpm turbo run build`);
    });
    expect(bundle, `${name} импортирует наш пакет в рантайме`).not.toMatch(
      /(from\s*|require\(\s*|import\(\s*)["']@mapward\//,
    );
  }
});

test("no package depends on an app", async () => {
  const apps = await readdir("apps", { withFileTypes: true });
  const appNames = await Promise.all(
    apps
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => (await manifest(path.join("apps", entry.name))).name),
  );

  const entries = await readdir("packages", { withFileTypes: true });
  const packages = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => manifest(path.join("packages", entry.name))),
  );

  for (const pkg of packages) {
    expect(
      pkg.deps.filter((dep) => appNames.includes(dep)),
      pkg.name,
    ).toEqual([]);
  }
});

async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sources(full);
      return Promise.resolve(
        /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [],
      );
    }),
  );
  return nested.flat();
}

const importsOf = (text: string) =>
  [...text.matchAll(/(?:^|\n)\s*(?:import|export)[^;"']*?from\s*["']([^"']+)["']/g)].map(
    (match) => match[1] ?? "",
  );

/**
 * Встроенные плагины — код проекта, а не часть клиента: из своего они знают только серверную
 * часть плагина и API окна. Кирпичи `views` чистые: React, API окна и соседние кирпичи — так
 * копия в карте собирается где угодно, и её можно править, не зная клиента.
 */
test("built-in plugins know only the plugin runtime and the window API; bricks know only the window API", async () => {
  const registry = "packages/plugins/registry";
  const offenders: string[] = [];
  for (const file of await sources(registry)) {
    const relative = path.relative(registry, file).replaceAll("\\", "/");
    const bricks = relative.startsWith("views/bricks/");
    // oxlint-disable-next-line no-await-in-loop
    for (const source of importsOf(await readFile(file, "utf8"))) {
      if (
        source.startsWith("@mapward/") &&
        !["@mapward/component", "@mapward/plugin"].includes(source)
      ) {
        offenders.push(`${relative}: ${source}`);
      }
      if (source.startsWith(".")) {
        const target = path.relative(registry, path.resolve(path.dirname(file), source));
        // Плагин ставят в карту отдельно: чужая папка рядом может и не лежать.
        if (target.startsWith("..") || target.split(path.sep)[0] !== relative.split("/")[0]) {
          offenders.push(`${relative}: ${source}`);
        }
        if (bricks && !target.replaceAll("\\", "/").startsWith("views/bricks/")) {
          offenders.push(`${relative}: ${source}`);
        }
      } else if (bricks && !["@mapward/component", "react", "react-dom"].includes(source)) {
        offenders.push(`${relative}: ${source}`);
      }
    }
  }
  expect(offenders).toEqual([]);
});
