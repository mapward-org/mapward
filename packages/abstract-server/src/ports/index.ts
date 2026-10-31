/**
 * Порты: всё, чего у сервера нет своего — решения 0014 и 0015.
 *
 * Реализует их приложение: расширение через api редактора, cli через node. Сервер не знает,
 * что там внутри, и поэтому одинаково работает в обоих.
 */

import type { Capabilities } from "@mapward/core";
import type { ProcessEnv } from "../lib/env.ts";

/**
 * Размер — у файлов, и только там, где хост может его назвать дёшево. Нужен он затем, что
 * директива в ответе приходит именем и путём, а весит иногда двадцать килобайт: не зная
 * размера, агент либо читает её целиком, либо режет мимо карты.
 */
export type FileEntry = { name: string; isDirectory: boolean; size?: number };

/**
 * Файлы — три порта, а не один: читать, писать и следить нужно разным классам, и класс,
 * которому достаточно чтения, записи не получает (решение 0041). Пути всегда с прямыми
 * слэшами и абсолютные — приложение приводит их к своему виду само.
 */
export type FileReader = {
  read(path: string): Promise<string | undefined>;
  list(path: string): Promise<FileEntry[]>;
  /** Содержимое байтами — для `bytes$` модели файлов (`@mapward/vfs`). Файла нет — `undefined`. */
  bytes?(path: string): Promise<Uint8Array | undefined>;
  /** Размер и время изменения без чтения — для `stat$`. Файла нет — `undefined`. */
  stat?(path: string): Promise<{ size: number; mtimeMs: number } | undefined>;
  /**
   * Настоящий путь за ссылками. Нужен сборке компонента (решение 0037): пакеты pnpm лежат по
   * ссылкам и свои зависимости находят от настоящего места. Хост не умеет — путь как есть.
   */
  realpath?(path: string): Promise<string | undefined>;
};

export type FileWriter = {
  write(path: string, text: string): Promise<void>;
  /** Убрать файл. Файла нет — это тоже успех: удаление зовут ради того, чтобы его не стало. */
  remove(path: string): Promise<void>;
};

export type FileWatcher = {
  /**
   * Следит за деревом и зовёт обратно с путём того, что изменилось.
   *
   * За чем именно следить, говорит зовущий: у карты это `json` и `md`, а у git-статуса —
   * `.git/index` и `.git/HEAD`, под которые ни одно расширение не подходит (решение 0023).
   * Без `include` берётся умолчание приложения — то, чем карта следилась всегда.
   */
  watch(
    root: string,
    onChange: (path: string) => void,
    options?: { include?: string[] },
  ): () => void;
};

/**
 * Перенос файла или папки целиком — правке карты (решение 0044): объект переезжает со всем, чего
 * модель не знает, — доками, кэшами, директивами. Родительская папка цели создаётся, цель
 * занята — ошибка. Хост, который переносить не умеет, правку с переносом не примет.
 */
export type FileMover = { move(from: string, to: string): Promise<void> };

/** Все разом — так файлы отдаёт приложение; классам сборка раздаёт их по отдельности. */
export type FilesPort = FileReader & FileWriter & FileWatcher & Partial<FileMover>;

export type ClockPort = { now(): string };

/** Таймеры тоже из среды: интервальная метрика тикает, пока объект открыт — решение 0013. */
export type TimersPort = {
  every(ms: number, run: () => void): () => void;
  /** Одноразовый: по нему истекает таймаут сбора — решение 0016. */
  after(ms: number, run: () => void): () => void;
};

/** Переменные окружения процесса: скрипт метрики ждёт их рядом со своими. */
export type EnvPort = { vars(): ProcessEnv };

/**
 * Сборщик дисплея-компонента — решение 0037. Сам esbuild в WebAssembly лежит в сервере, а
 * приложение отдаёт только его `.wasm`: где он лежит, знает оно одно — в расширении это
 * `dist`, в cli — `node_modules`.
 */
export type BundlerPort = { wasm(): Promise<Uint8Array> };

/**
 * Процесс плагина: долгоживущий, разговор строками протокола через stdio. Запускает его node
 * самой платформы — в редакторе это node расширения, в cli тот, что запустил cli: ставить свой
 * проекту не нужно.
 */
export type PluginProcess = {
  send(line: string): void;
  /** Строка stdout — одно сообщение протокола. */
  onLine(listener: (line: string) => void): void;
  /** stderr — лог плагина: туда же уходит его `console.log`. */
  onLog(listener: (text: string) => void): void;
  /** Слушателей бывает несколько: выход ждут и старт, и остановка. */
  onExit(listener: (code: number | null) => void): void;
  kill(): void;
};

export type PluginProcessPort = {
  start(params: { script: string; cwd: string; env: ProcessEnv }): PluginProcess;
};

/**
 * Доверие к плагину: чужой код карты запускается, только когда человек сказал «да». Спрашивает
 * и помнит ответ приложение — у пользователя, а не в репозитории: иначе чужой репозиторий
 * приносил бы «доверено» с собой. Где спросить некого, приложение просто отвечает, что знает.
 */
export type TrustPort = {
  allow(params: { mapPath: string; plugin: string }): Promise<boolean>;
  /**
   * Запомнить «да» без вопроса: так помечается встроенный плагин, который mapward скопировал в
   * карту сам, — его код пришёл с инструментом, а не с чужим репозиторием.
   */
  grant(params: { mapPath: string; plugin: string }): Promise<void>;
};

/**
 * Зависимости плагина — `dependencies` в его `package.json`, например библиотека холста у
 * встроенного `objects-map`. Ставит их приложение: `npm` в папке плагина (`PLUGIN_INSTALL`).
 * Промис отклоняется с выводом npm — по нему платформа и говорит, что не так (нет сети, нет npm).
 */
export type PackagesPort = { install(dir: string): Promise<void> };

/** Редактор для плагинов: `ctx.vscode`. Нет его — плагин узнаёт об этом из `ctx.isVscode`. */
export type EditorPort = {
  openFile(path: string, options: { line?: number; column?: number }): Promise<void>;
  /** Показать файл или папку в проводнике редактора. */
  reveal(path: string): Promise<void>;
  showMessage(text: string, level: "info" | "warning" | "error"): Promise<void>;
  terminal(command: string, options: { name?: string; cwd?: string }): Promise<void>;
  executeCommand(command: string, args: unknown[]): Promise<unknown>;
};

/**
 * Клиент карты для плагинов — `ctx.webview`: сборка вебвью и адрес моста до платформы по http.
 * Ответ `undefined` — клиента нет (платформа без редактора) или мост ещё не поднят.
 */
export type WebviewPort = () => { assets: string; bridge: string } | undefined;

export type { ProcessEnv };

/**
 * Что умеет хост, поднявший сервер — решение 0014. Тип общий с клиентом и живёт в `core`:
 * по нему клиент прячет то, чего хост не обещал.
 */
export type { Capabilities };

/**
 * Всё, что приложение отдаёт серверу. Это граница с приложением, а не зависимость класса:
 * связку целиком получает только сборка сервера и раздаёт из неё каждому его порты.
 */
export type ServerPorts = {
  files: FilesPort;
  clock: ClockPort;
  timers: TimersPort;
  env: EnvPort;
  capabilities: Capabilities;
  /** Хоста без сборщика компонент метрики не показывает, а говорит, что собрать нечем. */
  bundler?: BundlerPort;
  /** Без процессов плагины не запускаются: вызов отвечает ошибкой, карта живёт. */
  plugins?: PluginProcessPort;
  /** Без него недоверенных плагинов нет — запускается всё. Так только в тестах. */
  trust?: TrustPort;
  /** Без него встроенный плагин с зависимостями копируется, а поставить их просят человека. */
  packages?: PackagesPort;
  editor?: EditorPort;
  /** Есть только у редактора: им рисует плагин `screenshot`. */
  webview?: WebviewPort;
};
