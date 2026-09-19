import process from "node:process";
import type { McpTransport } from "@mapward/abstract-server";

/**
 * Транспорт MCP по stdio: json на строку. Логи уходят в stderr — stdout занят протоколом, и
 * одна лишняя строка в нём ломает разговор с агентом.
 */
export function stdioTransport(): McpTransport {
  return {
    onMessage(handler) {
      let buffer = "";
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        for (;;) {
          const cut = buffer.indexOf("\n");
          if (cut === -1) break;
          const line = buffer.slice(0, cut).trim();
          buffer = buffer.slice(cut + 1);
          if (!line) continue;
          try {
            handler(JSON.parse(line));
          } catch {
            process.stderr.write(`mapward: не разобрал строку: ${line}\n`);
          }
        }
      };

      process.stdin.on("data", onData);
      process.stdin.resume();
      return () => process.stdin.off("data", onData);
    },

    send(message) {
      process.stdout.write(`${JSON.stringify(message)}\n`);
    },
  };
}
