import { describe, expect, it } from "vitest";
import { excluded, matchesAny, matchesGlob } from "./glob.ts";

describe("globs of read-dir", () => {
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
