import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseSync } from "oxc-parser";
import { expect, test } from "vitest";

/**
 * Инвариант решения 0042: правила слоёв клиента держит тест, а не ревью. Удобный `useState` или
 * `div` в `compose` в диффе выглядит безобидно, и через месяц слои снова держатся на честном
 * слове.
 *
 * - компонент `compose` — `observer`;
 * - `compose` только составляет: без тегов разметки, `className` и `style`, без логики, из хуков —
 *   `useLocalStore` и хуки портов (`ports.tsx`). Можно выбрать, что показать (`? :`, `&&`),
 *   разложить список (`.map`) и передать обработчику один вызов;
 * - `ui` получает всё пропсами: не знает `model`, `adapters`, `compose` и портов фич;
 * - `ui` фичи — много маленьких вью: вью рисует теги, набор `lib/ui`, саму себя (дерево) и то, что
 *   пришло пропсами. Другие вью фичи — ни из соседнего файла, ни из своего: их собирает
 *   `compose` через `children` и рендер-пропсы. Компонент — не длиннее
 *   50 строк. Набор `lib/ui` общий, внутри себя собирается сам;
 * - `model` и `pure-model` не знают React, `pure-model` — и MobX;
 * - `model`, `adapters` и `ui` друг друга не импортируют, `pure-model` не импортирует никого из них;
 * - фичи друг друга не импортируют;
 * - состояние React не заводится нигде: ни `useState`, ни эффектов, ни мемоизации.
 */

const ROOT = "packages/abstract-react-client/src";

/**
 * Где хукам React место. Хук локального стора сам держит стор в React — иначе его негде держать,
 * а граф карты детей живёт в `@xyflow/react`, у которого своё состояние в React.
 */
const EXEMPT = new Set(["lib/mobx/use-local-store.ts", "features/children-map/ui/flow.tsx"]);

const REACT_STATE = new Set([
  "useState",
  "useReducer",
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
  "useMemo",
  "useCallback",
  "useSyncExternalStore",
  "useDeferredValue",
  "useTransition",
]);

/** Сколько строк на компонент `ui`: больше — значит, в нём спрятано несколько вью. */
const UI_LINES = 50;

const LAYERS = ["compose", "model", "adapters", "ui", "pure-model"] as const;
type Layer = (typeof LAYERS)[number];

type Node = { type: string; start: number; [key: string]: unknown };

async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      const code = /\.tsx?$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name);
      return Promise.resolve(code ? [full] : []);
    }),
  );
  return nested.flat();
}

const slash = (value: string) => value.replaceAll("\\", "/");

/** Слой файла — ближайшая папка слоя на пути; `entry` составляет, как `compose`. */
function layerOf(relative: string): Layer | "entry" | undefined {
  const parts = relative.split("/");
  if (parts[0] === "entry") return "entry";
  for (let at = parts.length - 2; at >= 0; at--) {
    const part = parts[at] as Layer;
    if (LAYERS.includes(part)) return part;
  }
  return undefined;
}

/** Фича файла: `features/<имя>/…`. */
const featureOf = (relative: string) =>
  relative.startsWith("features/") ? relative.split("/")[1] : undefined;

function children(node: Node): Node[] {
  const out: Node[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") continue;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === "object" && typeof (item as Node).type === "string") {
          out.push(item as Node);
        }
      }
    } else if (value && typeof value === "object" && typeof (value as Node).type === "string") {
      out.push(value as Node);
    }
  }
  return out;
}

function walk(node: Node, visit: (node: Node, ancestors: Node[]) => void, ancestors: Node[] = []) {
  visit(node, ancestors);
  for (const child of children(node)) walk(child, visit, [...ancestors, node]);
}

const calleeName = (node: Node): string | undefined => {
  const callee = node.callee as Node;
  if (callee.type === "Identifier") return callee.name as string;
  if (callee.type === "MemberExpression" && (callee.property as Node).type === "Identifier") {
    return (callee.property as Node).name as string;
  }
  return undefined;
};

const isComponentName = (name: unknown) => typeof name === "string" && /^[A-Z]/.test(name);

/** Обработчик в `compose` — один вызов, выбор или разметка, без тела. */
const SIMPLE = new Set([
  "CallExpression",
  "NewExpression",
  "ChainExpression",
  "JSXElement",
  "JSXFragment",
  "ConditionalExpression",
  "LogicalExpression",
  "Identifier",
  "MemberExpression",
  "Literal",
  "ObjectExpression",
]);

function checkCompose(file: string, program: Node, imports: Map<string, string>, fail: Fail) {
  // На верхнем уровне — импорты, типы и компоненты; остальное — вычисления, им место в сторе.
  for (const statement of program.body as Node[]) {
    const inner = (statement.declaration as Node | undefined) ?? statement;
    const kind = inner.type;
    if (
      statement.type === "ImportDeclaration" ||
      kind === "TSTypeAliasDeclaration" ||
      kind === "TSInterfaceDeclaration" ||
      (statement.type === "ExportNamedDeclaration" && !statement.declaration)
    ) {
      continue;
    }
    // Компонент — `observer`: рендер-пропсы он зовёт у себя, и без `observer` то, что они
    // читают из стора, никто не наблюдает — ленивая подписка так и не открывается.
    const bare =
      "компонент compose — observer(…), иначе прочитанное в рендер-пропсах не наблюдается";
    if (kind === "FunctionDeclaration" && isComponentName((inner.id as Node | null)?.name)) {
      fail(file, statement, bare);
      continue;
    }
    if (kind === "VariableDeclaration") {
      const declarations = inner.declarations as Node[];
      if (declarations.every((one) => isComponentName((one.id as Node).name))) {
        for (const one of declarations) {
          const init = one.init as Node | null;
          if (init?.type === "ArrowFunctionExpression" || init?.type === "FunctionExpression") {
            fail(file, one, bare);
          }
        }
        continue;
      }
    }
    fail(file, statement, "на верхнем уровне compose — только импорты, типы и компоненты");
  }

  walk(program, (node, ancestors) => {
    switch (node.type) {
      case "JSXOpeningElement": {
        const name = node.name as Node;
        if (name.type === "JSXIdentifier" && /^[a-z]/.test(name.name as string)) {
          fail(file, node, `тег <${String(name.name)}> — разметке место в ui`);
        }
        break;
      }
      case "JSXAttribute": {
        const name = (node.name as Node).name;
        if (name === "className" || name === "style") {
          fail(file, node, `${String(name)} — оформлению место в ui`);
        }
        break;
      }
      case "IfStatement":
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "WhileStatement":
      case "DoWhileStatement":
      case "SwitchStatement":
      case "TryStatement":
        fail(file, node, `${node.type} — логике место в сторе`);
        break;
      case "TemplateLiteral":
        fail(file, node, "строка собирается шаблоном — вычислениям место в сторе или ui");
        break;
      case "BinaryExpression": {
        if (["+", "-", "*", "/", "%", "**"].includes(node.operator as string)) {
          fail(file, node, `арифметика (${String(node.operator)}) — вычислениям место в сторе`);
        }
        break;
      }
      case "CallExpression": {
        const name = calleeName(node);
        if (name && /^use[A-Z]/.test(name) && name !== "useLocalStore") {
          const source = imports.get(name) ?? "";
          if (!/(^|\/)ports(\.tsx?)?$/.test(source) && !/\/ports\//.test(source)) {
            fail(file, node, `${name} — в compose только useLocalStore и хуки портов`);
          }
        }
        break;
      }
      case "ArrowFunctionExpression":
      case "FunctionExpression": {
        // Сам компонент — функция с телом; всё, что внутри него, — однострочное.
        const component = ancestors.every(
          (one) =>
            one.type === "Program" ||
            one.type === "ExportNamedDeclaration" ||
            one.type === "VariableDeclaration" ||
            one.type === "VariableDeclarator" ||
            (one.type === "CallExpression" && calleeName(one) === "observer"),
        );
        if (component) break;
        // Скобки вокруг выражения парсер сохраняет — смотрим на то, что внутри них.
        let body = node.body as Node;
        while (body.type === "ParenthesizedExpression") body = body.expression as Node;
        if (body.type === "BlockStatement" || !SIMPLE.has(body.type)) {
          fail(file, node, "функция внутри compose — только один вызов, выбор или разметка");
        }
        break;
      }
      case "VariableDeclarator": {
        const init = node.init as Node | null;
        const inComponent = ancestors.some((one) => one.type === "BlockStatement");
        if (!inComponent || !init) break;
        const hook = init.type === "CallExpression" && /^use[A-Z]/.test(calleeName(init) ?? "");
        if (!hook && init.type !== "Identifier" && init.type !== "MemberExpression") {
          fail(file, node, "вычисление в compose — ему место в сторе");
        }
        break;
      }
      default:
        break;
    }
  });
}

type Fail = (file: string, node: Node | undefined, message: string) => void;

/** Имя компонента, который объявляет инструкция верхнего уровня, — если объявляет. */
function componentOf(statement: Node): string | undefined {
  const inner = (statement.declaration as Node | undefined) ?? statement;
  if (inner.type === "FunctionDeclaration") {
    const name = (inner.id as Node | null)?.name;
    return isComponentName(name) ? (name as string) : undefined;
  }
  if (inner.type === "VariableDeclaration") {
    const [one] = inner.declarations as Node[];
    const name = (one?.id as Node | undefined)?.name;
    return isComponentName(name) ? (name as string) : undefined;
  }
  return undefined;
}

function checkUi(
  file: string,
  program: Node,
  imports: Map<string, string>,
  lines: (node: Node) => number,
  fail: Fail,
) {
  const local = new Set<string>();
  for (const statement of program.body as Node[]) {
    const name = componentOf(statement);
    if (name) local.add(name);
  }

  for (const statement of program.body as Node[]) {
    const own = componentOf(statement);
    if (own && lines(statement) > UI_LINES) {
      fail(file, statement, `${own} длиннее ${UI_LINES} строк — разрежь на вью, собери в compose`);
    }
    walk(statement, (node) => {
      if (node.type !== "JSXOpeningElement") return;
      const tag = node.name as Node;
      const name = tag.type === "JSXIdentifier" ? (tag.name as string) : undefined;
      if (!name || !isComponentName(name) || name === own) return;
      const source = imports.get(name);
      const sibling = source !== undefined && source.startsWith(".") && !/(^|\/)lib\//.test(source);
      if (local.has(name) || sibling) {
        fail(file, node, `<${name}> — вью собирает compose через children и рендер-пропсы`);
      }
    });
  }
}

test("слои клиента держатся правил — решение 0042", async () => {
  const files = await sources(ROOT);
  expect(files.length).toBeGreaterThan(0);
  const offenders: string[] = [];

  for (const full of files) {
    const relative = slash(path.relative(ROOT, full));
    // oxlint-disable-next-line no-await-in-loop
    const text = await readFile(full, "utf8");
    const parsed = parseSync(full, text);
    const program = parsed.program as unknown as Node;
    const line = (node: Node | undefined) =>
      node ? text.slice(0, node.start).split("\n").length : 0;
    const fail: Fail = (file, node, message) => offenders.push(`${file}:${line(node)} ${message}`);

    const layer = layerOf(relative);
    const feature = featureOf(relative);
    const imports = new Map<string, string>();

    for (const statement of program.body as Node[]) {
      if (statement.type !== "ImportDeclaration") continue;
      const source = (statement.source as Node).value as string;
      for (const spec of (statement.specifiers as Node[]) ?? []) {
        imports.set((spec.local as Node).name as string, source);
      }

      if (source.includes("rxjs-react")) fail(relative, statement, "переходники rxjs → React ушли");

      // Куда ведёт относительный импорт — внутри клиента.
      const target = source.startsWith(".")
        ? slash(path.relative(ROOT, path.resolve(path.dirname(full), source)))
        : undefined;
      if (target) {
        const targetFeature = featureOf(target);
        if (feature && targetFeature && targetFeature !== feature) {
          fail(relative, statement, `фича ${feature} импортирует фичу ${targetFeature}`);
        }
        const targetLayer = layerOf(target);
        const sameUnit =
          feature !== undefined ? targetFeature === feature : !target.startsWith("features/");
        if (layer && targetLayer && sameUnit && targetLayer !== layer) {
          const allowed: Record<string, string[]> = {
            compose: ["model", "adapters", "ui", "pure-model"],
            entry: ["compose", "model", "adapters", "ui", "pure-model"],
            model: ["pure-model"],
            adapters: ["pure-model"],
            ui: ["pure-model"],
            "pure-model": [],
          };
          if (!(allowed[layer] ?? []).includes(targetLayer)) {
            fail(relative, statement, `${layer} импортирует ${targetLayer}`);
          }
        }
        if (layer === "ui" && /(^|\/)ports\.tsx?$/.test(target) && target.startsWith("features/")) {
          fail(relative, statement, "ui не знает портов фичи — всё приходит пропсами");
        }
      }

      if ((layer === "model" || layer === "pure-model") && /^react(-dom)?(\/|$)/.test(source)) {
        fail(relative, statement, `${layer} не знает React`);
      }
      if ((layer === "model" || layer === "pure-model") && source === "mobx-react-lite") {
        fail(relative, statement, `${layer} не знает React`);
      }
      if (layer === "pure-model" && source === "mobx") {
        fail(relative, statement, "pure-model — чистые функции, без MobX");
      }
    }

    if (!EXEMPT.has(relative)) {
      walk(program, (node) => {
        if (node.type !== "CallExpression") return;
        const name = calleeName(node);
        if (name && REACT_STATE.has(name)) {
          fail(relative, node, `${name} — состояние и эффекты живут в сторах MobX`);
        }
      });
    }

    if (layer === "compose" || layer === "entry") checkCompose(relative, program, imports, fail);
    if (layer === "ui" && feature && !EXEMPT.has(relative)) {
      const lines = (node: Node) => text.slice(node.start, node.end as number).split("\n").length;
      checkUi(relative, program, imports, lines, fail);
    }
  }

  expect(offenders).toEqual([]);
});
