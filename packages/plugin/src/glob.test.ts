import { describe, expect, it } from "vitest";
import { excluded, globBase, matchesAny, matchesGlob } from "./glob.ts";

describe("globs", () => {
  it("matches a name at the top level only", () => {
    expect(matchesGlob("requirement.md", "*.md")).toBe(true);
    expect(matchesGlob("nested/requirement.md", "*.md")).toBe(false);
    expect(matchesGlob("nested/requirement.md", "**/*.md")).toBe(true);
  });

  it("lets `**` stand for nothing at all", () => {
    // Otherwise a walk descends into the folder before noticing it is excluded.
    expect(matchesGlob("node_modules", "**/node_modules/**")).toBe(true);
    expect(matchesGlob("apps/x/node_modules/react", "**/node_modules/**")).toBe(true);
  });

  it("keeps a dot a dot", () => {
    expect(matchesGlob("axmd", "a.md")).toBe(false);
  });

  it("includes everything when nothing is asked for", () => {
    expect(matchesAny("whatever", undefined)).toBe(true);
    expect(matchesAny("whatever", [])).toBe(true);
  });

  it("excludes nothing when nothing is asked for", () => {
    expect(excluded("whatever", undefined)).toBe(false);
  });
});

describe("globBase", () => {
  it("stops at the first segment with a wildcard", () => {
    expect(globBase("src/**/*.ts")).toBe("src");
    expect(globBase("/repo/ru/requirements/**/*.md")).toBe("/repo/ru/requirements");
    expect(globBase("*.md")).toBe("");
  });

  it("takes the folder of a plain file", () => {
    expect(globBase("/repo/package.json")).toBe("/repo");
  });
});
