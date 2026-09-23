import type { MetricConfig } from "./schema.ts";
import { dirname, join } from "../lib/path.ts";

const isAbsolute = (path: string) => path.startsWith("/") || /^[a-zA-Z]:\//.test(path);

/**
 * Пути компонента и схемы считаются от папки того `config.json`, где они написаны, а не от
 * наследника: компонент прототипа лежит у прототипа, и наследник с одной строкой `extends`
 * должен его находить. После мерджа слой уже не виден, поэтому путь делается абсолютным
 * сразу, как слой прочитан.
 */
export function anchorDisplay(config: MetricConfig, configPath: string): MetricConfig {
  const display = config.display;
  if (!display) return config;
  const dir = dirname(configPath);
  const anchor = (path: string) =>
    isAbsolute(path.replaceAll("\\", "/")) ? path.replaceAll("\\", "/") : join(dir, path);

  return {
    ...config,
    display: {
      ...display,
      ...(display.component === undefined ? {} : { component: anchor(display.component) }),
      ...(typeof display.schema === "string" ? { schema: anchor(display.schema) } : {}),
    },
  };
}
