/**
 * @mapward/vfs — файлы потоками с точечной подпиской.
 *
 * Файл и папка читаются, когда на них подписались, и отпускаются, когда подписчиков не осталось;
 * вотчер один на корень и стоит, пока читается хоть что-то, изменения идут пачкой по тишине.
 * Диск, вотчер, таймеры и часы — порты (`ports.ts`): пакет не знает ни node, ни карты. Им живут
 * модель карты на сервере и плагины (`createVfs` из `@mapward/plugin`).
 *
 * ```ts
 * const disk = new DiskFiles(root, reader, watcher, timers, clock);
 * const files = new LiveFiles(disk, keepFor(timers, 30_000));
 * files.json$(`${root}/package.json`).subscribe(…);
 * ```
 */
export type {
  ClockPort,
  FileEntry,
  FileReader,
  FileStat,
  FileWatcher,
  TimersPort,
} from "./ports.ts";
export { LiveFiles, type FileSource } from "./files.ts";
export { DiskFiles, pathKey } from "./disk.ts";
export { keepFor } from "./keep.ts";
export { debounce } from "./debounce.ts";
export {
  cached,
  every,
  follow,
  isReady,
  mapReady,
  PENDING,
  ready,
  sameBytes,
  sameJson,
  settle,
  stable,
  type Maybe,
  type Pending,
} from "./stream.ts";
