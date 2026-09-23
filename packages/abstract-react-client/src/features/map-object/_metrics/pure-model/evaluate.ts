/**
 * Собранный компонент — CommonJS-модуль без своих `react` и `@mapward/display` (решение 0037):
 * их отдаёт клиент, иначе на странице две копии React и хуки ломаются. Здесь модуль
 * выполняется, и `require` отвечает тем, что дали.
 */
export function evaluateModule(code: string, provided: Record<string, unknown>): unknown {
  const module: { exports: Record<string, unknown> } = { exports: {} };
  const require = (id: string): unknown => {
    if (id in provided) return provided[id];
    throw new Error(`модуль ${id} на карте не отдаётся: его надо вложить в сборку`);
  };
  // Код карты свой — его пишет автор карты или её агент, поэтому выполняется он как есть.
  // oxlint-disable-next-line no-new-func
  const run = new Function("require", "module", "exports", code) as (
    require: (id: string) => unknown,
    module: { exports: Record<string, unknown> },
    exports: Record<string, unknown>,
  ) => void;
  run(require, module, module.exports);
  return "default" in module.exports ? module.exports.default : module.exports;
}
