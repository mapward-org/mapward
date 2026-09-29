import { action, makeObservable, observable } from "mobx";
import { LiveMap, type LiveFiles, type LiveObject } from "@mapward/core";

type Ref = { mapPath: string; basePath: string; name: string };

/**
 * Карта одного вида — живая модель из `core` (решения 0041 и 0042). Её держит точка входа, а
 * фичи получают через свои порты: узел по адресу, предков для крошек, перечитывание. Снимком
 * карту здесь не держит никто: каждый читает у узла свои поля.
 */
export class MapView {
  readonly live: LiveMap;
  reloading = false;

  constructor(
    files: LiveFiles,
    readonly ref: Ref,
    private readonly reloadMap: () => Promise<void>,
  ) {
    this.live = new LiveMap(files, ref);
    makeObservable(this, { reloading: observable, reload: action });
  }

  get root(): LiveObject {
    return this.live.root;
  }

  /** Объект по адресу; пропал — корень: пропавший объект ведёт к корню, а не в пустоту. */
  object(address: string): LiveObject {
    return this.live.find(address) ?? this.live.root;
  }

  /** Есть ли объект по адресу — для стрелок истории. */
  has(address: string): boolean {
    return this.live.find(address) !== undefined;
  }

  /** Предки объекта от корня, без него самого: читаются только папки на пути и их индексы. */
  ancestors(address: string): LiveObject[] {
    return this.live.ancestors(address);
  }

  /** Корень прочитан: имя и вкладки уже настоящие, можно рисовать. */
  get ready(): boolean {
    return this.live.root.ready;
  }

  /** Перечитать карту. Пока идёт, кнопка гаснет, чтобы второй клик не заводил второго. */
  reload(): void {
    if (this.reloading) return;
    this.reloading = true;
    void this.reloadMap().finally(
      action(() => {
        this.reloading = false;
      }),
    );
  }
}
