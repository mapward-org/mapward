import { action, computed, makeObservable, observableRef } from "mobx";
import { splitMount } from "@mapward/core";
import type { History } from "../pure-model/navigation.ts";
import type { StartAt } from "./screen.ts";

type Ref = { mapPath: string; basePath: string; name: string };

/** Кадр — экран на одной карте: её история и с чего начать, если истории ещё нет. */
export type Frame = { map: Ref; mount?: string; start?: StartAt; history?: History };

/** Что экрану нужно от кадров: уйти в подключённую карту и вернуться из неё. */
export type ScreenFrames = {
  /** Ссылка `mapward://leafer:/…` — новый кадр на карте проекта; не подключена — `false`. */
  enter(link: string, history: History): boolean;
  /** Карта и адрес в ней по ссылке с именем подключения — для табов. */
  target(link: string): { map: Ref; address: string } | undefined;
  /** Назад в карту, откуда пришли, — у кадра подключённой карты. */
  leave: { name: string; go(): void } | undefined;
};

/**
 * Переход в подключённую карту — на месте, а не отдельным табом: экран объекта целиком живёт
 * на одной карте — прогоны, экшоны, метрики, правка холста, — поэтому объект проекта
 * открывается новым кадром поверх прежнего, со своей картой и своей историей. «Назад» с начала
 * его истории возвращает в прежний кадр, и тот встаёт на том месте, откуда ушли.
 *
 * Хранится только история нижнего кадра — той карты, на которой открыт вид. Кадры поверх неё
 * живут, пока жив вид: перезагрузка окна возвращает в неё.
 */
export class MapFrames implements ScreenFrames {
  frames: Frame[];

  constructor(
    base: Frame,
    private readonly resolve: (from: Ref, mount: string) => Ref | { error: string },
    private readonly persist?: (history: History) => void,
  ) {
    this.frames = [base];
    makeObservable(this, {
      frames: observableRef,
      top: computed,
      leave: computed,
      enter: action,
      save: action,
    });
  }

  get top(): Frame {
    return this.frames.at(-1) as Frame;
  }

  /** По нему вид пересоздаётся: у каждого кадра свой экран и своя карта. */
  get key(): number {
    return this.frames.length;
  }

  /** История открытого кадра: у нижнего сохраняется, у верхних — только держится. */
  save(history: History): void {
    this.frames = [...this.frames.slice(0, -1), { ...this.top, history }];
    if (this.frames.length === 1) this.persist?.(history);
  }

  target(link: string): { map: Ref; address: string } | undefined {
    const split = splitMount(link);
    if (!split) return undefined;
    const found = this.resolve(this.top.map, split.mount);
    return "error" in found ? undefined : { map: found, address: split.local };
  }

  enter(link: string, history: History): boolean {
    const target = this.target(link);
    const split = splitMount(link);
    if (!target || !split) return false;
    this.frames = [
      ...this.frames.slice(0, -1),
      { ...this.top, history },
      { map: target.map, mount: split.mount, start: { address: target.address } },
    ];
    return true;
  }

  get leave(): { name: string; go(): void } | undefined {
    const parent = this.frames.at(-2);
    const mount = this.top.mount;
    if (!parent) return undefined;
    return {
      name: mount === undefined ? parent.map.name : `${parent.map.name} › ${mount}:`,
      go: action(() => {
        this.frames = this.frames.slice(0, -1);
      }),
    };
  }
}
