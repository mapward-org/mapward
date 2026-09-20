/**
 * Порты: всё, чего у сервера нет своего — решения 0014 и 0015.
 *
 * Реализует их приложение: расширение через api редактора, cli через node. Сервер не знает,
 * что там внутри, и поэтому одинаково работает в обоих.
 */

import type { Capabilities } from "@mapward/core";
import type { Cancellation } from "../lib/cancellation.ts";
import type { ProcessEnv } from "../lib/env.ts";

/**
 * Размер — у файлов, и только там, где хост может его назвать дёшево. Нужен он затем, что
 * директива в ответе приходит именем и путём, а весит иногда двадцать килобайт: не зная
 * размера, агент либо читает её целиком, либо режет мимо карты.
 */
export type FileEntry = { name: string; isDirectory: boolean; size?: number };

/** Пути всегда с прямыми слэшами и абсолютные — приложение приводит их к своему виду само. */
export type FilesPort = {
  read(path: string): Promise<string | undefined>;
  list(path: string): Promise<FileEntry[]>;
  write(path: string, text: string): Promise<void>;
  /** Убрать файл. Файла нет — это тоже успех: удаление зовут ради того, чтобы его не стало. */
  remove(path: string): Promise<void>;
  /** Следит за деревом и зовёт обратно с путём того, что изменилось. */
  watch(root: string, onChange: (path: string) => void): () => void;
};

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

/** Агент в headless-режиме: один вопрос, один ответ, промпт уходит в stdin. */
export type AgentPort = {
  run(params: {
    prompt: string;
    cwd: string;
    env: ProcessEnv;
    cancel?: Cancellation;
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

export type { Cancellation, ProcessEnv };

/**
 * Что умеет хост, поднявший сервер — решение 0014. Тип общий с клиентом и живёт в `core`:
 * по нему клиент прячет то, чего хост не обещал.
 */
export type { Capabilities };

export type ServerPorts = {
  files: FilesPort;
  shell: ShellPort;
  agent: AgentPort;
  clock: ClockPort;
  timers: TimersPort;
  env: EnvPort;
  capabilities: Capabilities;
};
