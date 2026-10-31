/**
 * Что пакету нужно от среды — ровно столько, сколько он зовёт. Пакет не знает, где запущен:
 * сервер даёт свои порты (у него они шире и этим типам соответствуют), плагину их даёт
 * `@mapward/plugin` поверх node. Пути — строки с прямыми слэшами.
 */

/** Что лежит в папке: имя, папка ли, и размер, когда среда его назвала. */
export type FileEntry = { name: string; isDirectory: boolean; size?: number };

/** Размер и время изменения файла — без чтения содержимого. */
export type FileStat = { size: number; mtimeMs: number };

export type FileReader = {
  /** Текст файла; файла нет — `undefined`. */
  read(path: string): Promise<string | undefined>;
  /** Содержимое папки; папки нет — пусто. */
  list(path: string): Promise<FileEntry[]>;
  /**
   * Содержимое как есть, байтами: картинка, индекс git — то, что текстом испортится. Файла нет —
   * `undefined`. Хост, который так не умеет, этих файлов не отдаёт: тоже `undefined`.
   */
  bytes?(path: string): Promise<Uint8Array | undefined>;
  /**
   * Размер и время изменения: дешёвый сигнал «файл изменился», когда само содержимое не нужно.
   * Файла нет (или хост не умеет) — `undefined`.
   */
  stat?(path: string): Promise<FileStat | undefined>;
};

export type FileWatcher = {
  /** Следит за деревом под `root` и зовёт обратно с путём того, что изменилось; отдаёт отписку. */
  watch(root: string, onChange: (path: string) => void): () => void;
};

export type TimersPort = {
  /** Одноразовый таймер; отдаёт отмену. */
  after(ms: number, run: () => void): () => void;
};

/** Время строкой ISO — как его отдаёт `Date.prototype.toISOString`. */
export type ClockPort = { now(): string };
