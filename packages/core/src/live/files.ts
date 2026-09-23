import type { FolderEntry } from "../model/raw-object.ts";
import { PENDING, Resource, type Pending } from "./resource.ts";

/**
 * Откуда живая модель берёт файлы — решение 0041. На сервере это диск с вотчером, на клиенте
 * мост. Подписка отдаёт первое содержимое и дальше каждое изменение; отписка — файл больше
 * никому не нужен.
 */
export type FileSource = {
  /** Содержимое файла; файла нет — `undefined`. */
  file(path: string, next: (text: string | undefined) => void): () => void;
  /** Содержимое папки; папки нет — пусто. */
  list(path: string, next: (entries: FolderEntry[]) => void): () => void;
};

export { PENDING, type Pending };

/**
 * Файлы карты ресурсами: файл читается, когда его поле впервые прочитали, и отпускается, когда
 * читать перестали (решение 0042). Ресурс заводится на путь один раз и живёт дальше: пока его
 * никто не читает, он и не подписан.
 */
export class LiveFiles {
  private readonly files = new Map<string, Resource<string | undefined>>();
  private readonly folders = new Map<string, Resource<FolderEntry[]>>();

  constructor(private readonly source: FileSource) {}

  /** Текст файла, `undefined` — файла нет, `PENDING` — ещё не пришёл. */
  text(path: string): string | undefined | Pending {
    let file = this.files.get(path);
    if (!file) {
      file = new Resource((next) => this.source.file(path, next));
      this.files.set(path, file);
    }
    return file.current;
  }

  /** Содержимое папки, `PENDING` — ещё не пришло. */
  list(path: string): FolderEntry[] | Pending {
    let folder = this.folders.get(path);
    if (!folder) {
      folder = new Resource((next) => this.source.list(path, next));
      this.folders.set(path, folder);
    }
    return folder.current;
  }
}
