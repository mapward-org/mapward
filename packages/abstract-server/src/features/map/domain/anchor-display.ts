import { isAddress, type ActionConfig, type MetricConfig, type MetricGroup } from "@mapward/core";
import { dirname, join } from "../../../lib/path.ts";

const isAbsolute = (path: string) => path.startsWith("/") || /^[a-zA-Z]:\//.test(path);

/**
 * Путь от папки `dir`; абсолютный остаётся собой, только со слэшами вперёд. Путь, который
 * начинается подстановкой (`${{ mapward:// }}/_plugins/files`), станет абсолютным после неё: слой
 * читается раньше подстановок, и привязывать его к папке значило бы испортить.
 */
const anchorPath = (path: string, dir: string) => {
  const forward = path.replaceAll("\\", "/");
  return isAbsolute(forward) || forward.startsWith("${{") ? forward : join(dir, path);
};

/**
 * Пути считаются от папки того `config.json`, где они написаны, а не от наследника: компонент
 * прототипа лежит у прототипа, и наследник с одной строкой `extends` должен его находить. После
 * мерджа слой уже не виден, поэтому путь делается абсолютным сразу, как слой прочитан: компонент
 * метрики и плагин её запроса для агента. Что лежит в `params`, платформа не толкует.
 */
export function anchorDisplay(config: MetricConfig, configPath: string): MetricConfig {
  const dir = dirname(configPath);
  const anchor = (path: string) => anchorPath(path, dir);
  return {
    ...config,
    ...(config.component === undefined ? {} : { component: anchor(config.component) }),
    ...(config.agent === undefined
      ? {}
      : { agent: { ...config.agent, plugin: anchor(config.agent.plugin) } }),
  };
}

/**
 * Плагин и своя форма экшона — так же, как у метрики: от папки того `config.json`, где они
 * написаны. Общий экшон по `extends` зовёт плагин и рисует форму у себя, а не у наследника.
 */
export function anchorAction(config: ActionConfig, configPath: string): ActionConfig {
  const dir = dirname(configPath);
  return {
    ...config,
    ...(config.plugin === undefined ? {} : { plugin: anchorPath(config.plugin, dir) }),
    ...(config.component === undefined ? {} : { component: anchorPath(config.component, dir) }),
  };
}

/**
 * Раскладка группы — так же, как компонент метрики: путь считается от папки того `_index.json`,
 * где группа написана. Раскладка прототипа лежит у прототипа, а наследник, получивший группу по
 * `extends`, о его папке ничего не знает. Адрес `mapward://` остаётся адресом: куда он ведёт,
 * знает тот, кто знает папку карты.
 */
export function anchorGroups(groups: MetricGroup[], indexDir: string): MetricGroup[] {
  return groups.map((group) =>
    group.layout === undefined || isAddress(group.layout)
      ? group
      : { ...group, layout: anchorPath(group.layout, indexDir) },
  );
}
