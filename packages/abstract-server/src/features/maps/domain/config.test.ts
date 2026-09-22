import { expect, test } from "vitest";
import { parseSettings } from "./config.ts";

const settings = (extra: Record<string, unknown>) =>
  parseSettings(JSON.stringify({ maps: [{ mapUrl: "map" }], ...extra }));

/** Решение 0032: постоянный порт MCP включает терминалы, которые переживают перезагрузку окна. */
test("mcpPort is read as a port number", () => {
  expect(settings({ mcpPort: 47000 })).toEqual({ mcpPort: 47000 });
});

test("a port that cannot be listened on is dropped, not fatal", () => {
  expect(settings({ mcpPort: 0 })).toEqual({});
  expect(settings({ mcpPort: 70000 })).toEqual({});
  expect(settings({ mcpPort: 4.5 })).toEqual({});
});
