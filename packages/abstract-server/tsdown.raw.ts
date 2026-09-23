type Fs = { readFile(path: string, options: { encoding: "utf8" }): Promise<string> };

const RAW = "?raw";

/**
 * `?raw` — файл строкой, как в vite, на котором гоняются тесты. Нужен css tailwind: он едет
 * внутри сервера, потому что у установленного расширения `node_modules` нет (решение 0037).
 *
 * Пакет ищется руками, от импортирующего вверх: резолвер сборки отдал бы его внешней
 * зависимостью, и `?raw` доехал бы до сборки расширения, которая про него не знает. Файлы
 * читаются через `this.fs`: типов node у пакета нет, и заводить их ради конфига значило бы
 * пустить node в исходники сервера.
 *
 * Лежит отдельно от конфига: сервер бандлится и расширением — из исходников, по путям
 * `tsconfig`, — и там этот `?raw` тоже нужно понимать.
 */
export const raw = {
  name: "raw",
  resolveId: {
    order: "pre" as const,
    async handler(this: { fs: Fs }, source: string, importer?: string) {
      if (!source.endsWith(RAW) || !importer) return null;
      const wanted = source.slice(0, -RAW.length);
      let dir = importer.replaceAll("\\", "/").replace(/\/[^/]*$/, "");
      while (dir.includes("/")) {
        const path = `${dir}/node_modules/${wanted}`;
        try {
          // oxlint-disable-next-line no-await-in-loop
          await this.fs.readFile(path, { encoding: "utf8" });
          return `${path}${RAW}`;
        } catch {
          dir = dir.replace(/\/[^/]*$/, "");
        }
      }
      return null;
    },
  },
  async load(this: { fs: Fs }, id: string) {
    if (!id.endsWith(RAW)) return null;
    const text = await this.fs.readFile(id.slice(0, -RAW.length), { encoding: "utf8" });
    return `export default ${JSON.stringify(text)};`;
  },
};
