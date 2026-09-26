import { describe, expect, it } from "vitest";
import { rootOf, touches, watchPlan } from "./step-watch.ts";

describe("watch of a step", () => {
  it("read-dir watches what it reads when told just true", () => {
    const { targets, problems } = watchPlan(
      {
        collectors: [
          { kind: "read-dir", basePath: "/repo/src", exclude: ["**/*.test.ts"], watch: true },
        ],
      },
      "/map",
    );
    expect(problems).toEqual([]);
    expect(targets).toHaveLength(1);
    const [target] = targets;
    expect(target?.roots).toEqual([{ root: "/repo/src", pattern: "**" }]);
    expect(target && touches(target, "/repo/src/a/b.ts")).toBe(true);
    expect(target && touches(target, "/repo/src/a/b.test.ts")).toBe(false);
  });

  it("an explicit include wins over what read-dir reads", () => {
    const { targets } = watchPlan(
      {
        collectors: [
          {
            kind: "read-dir",
            basePath: "/repo/src",
            include: ["**/*.md"],
            watch: { include: ["**/*.ts"], debounce: 50 },
          },
        ],
      },
      "/map",
    );
    expect(targets[0]?.include).toEqual(["/repo/src/**/*.ts"]);
    expect(targets[0]?.debounce).toBe(50);
  });

  it("a script watches from the map root, an absolute path stays as it is", () => {
    const { targets } = watchPlan(
      {
        transforms: [
          { kind: "script", run: "x", watch: { include: ["notes/*.md", "D:/code/src/**/*.ts"] } },
        ],
      },
      "/map",
    );
    expect(targets[0]?.stage).toBe("transform");
    expect(targets[0]?.roots).toEqual([
      { root: "/map/notes", pattern: "*.md" },
      { root: "D:/code/src", pattern: "**/*.ts" },
    ]);
    // Диск редактор пишет по-своему, регистр не сверяется.
    expect(targets[0] && touches(targets[0], "d:\\code\\src\\a.ts")).toBe(true);
  });

  it("a step that knows no paths of its own and names none is a problem, not silence", () => {
    const { targets, problems } = watchPlan(
      { collectors: [{ kind: "script", name: "tests", run: "x", watch: true }] },
      "/map",
    );
    expect(targets).toEqual([]);
    expect(problems).toEqual([expect.stringContaining("tests")]);
  });

  it("a malformed watch is a problem too", () => {
    const { problems } = watchPlan(
      { collectors: [{ kind: "script", run: "x", watch: { include: "src" } }] },
      "/map",
    );
    expect(problems).toHaveLength(1);
  });

  it("the watched folder is everything before the first glob", () => {
    expect(rootOf("/repo/src/**/*.ts")).toEqual({ root: "/repo/src", pattern: "**/*.ts" });
    expect(rootOf("/repo/package.json")).toEqual({ root: "/repo", pattern: "package.json" });
  });
});
