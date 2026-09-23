/**
 * Порты: всё, чего у сервера нет своего — решения 0014 и 0015.
 *
 * Реализует их приложение: расширение через api редактора, cli через node. Сервер не знает,
 * что там внутри, и поэтому одинаково работает в обоих.
 */

import type { ActionPermissions, Capabilities } from "@mapward/core";
import type { Cancellation } from "../lib/cancellation.ts";
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

/** Все три разом — так файлы отдаёт приложение; классам сборка раздаёт их по отдельности. */
export type FilesPort = FileReader & FileWriter & FileWatcher;

export type ProcessResult = { stdout: string; stderr: string };

export type ShellPort = {
  /** Команда оболочки: вывод отдаётся целиком, ошибка бросается. */
  run(
    command: string,
    options: { cwd: string; env: ProcessEnv; cancel?: Cancellation },
  ): Promise<ProcessResult>;
  /** Команда со входом в stdin — так трансформу не нужно ничего экранировать. */
  pipe(
    command: string,
    options: { cwd: string; env: ProcessEnv; input: string; cancel?: Cancellation },
  ): Promise<ProcessResult>;
};

/**
 * Агент в headless-режиме: один вопрос, один ответ, промпт уходит в stdin.
 *
 * `permissions` — что ему можно (решение 0038): метрике не нужно ничего, она читает, а экшону
 * нужно писать. Во флаги агента их превращает приложение: какой агент, знает оно одно.
 */
export type AgentPort = {
  run(params: {
    prompt: string;
    cwd: string;
    env: ProcessEnv;
    cancel?: Cancellation;
    permissions?: ActionPermissions;
  }): Promise<ProcessResult>;
};

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

export type { Cancellation, ProcessEnv };

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
  shell: ShellPort;
  agent: AgentPort;
  clock: ClockPort;
  timers: TimersPort;
  env: EnvPort;
  capabilities: Capabilities;
  /** Хоста без сборщика компонент метрики не показывает, а говорит, что собрать нечем. */
  bundler?: BundlerPort;
};
