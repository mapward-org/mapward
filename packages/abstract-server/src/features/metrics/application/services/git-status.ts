import type { GitLetter } from "@mapward/core";
import type {
  ClockPort,
  EnvPort,
  FileWatcher,
  ShellPort,
  TimersPort,
} from "../../../../ports/index.ts";
import { dirname, slash } from "../../../../lib/path.ts";
import { debounce } from "../../../../lib/debounce.ts";
import { foldersOf, parsePorcelain, strongest } from "../../domain/git.ts";

/**
 * Состояние git по корням репозиториев — решение 0023.
 *
 * Держится по корню, а не по метрике: один `git status` отвечает всем узлам всех метрик этого
 * репозитория, а карта показывает один репозиторий десятком деревьев.
 *
 * Вся работа со средой здесь: команда через `ShellPort`, вотчер через `FilesPort`, время через
 * часы. Само правило перевода `XY` в букву — в `domain/git.ts`, и о среде оно не знает.
 */

/** Сколько собранный статус считается свежим без вотчера. Под подпиской его сбрасывает вотчер. */
const FRESH_MS = 2000;

/** Одна команда git трогает `.git` несколько раз подряд; ждём тишины. */
const QUIET_MS = 300;

type Repo = { root: string; gitDir: string };

type Marks = {
  at: number;
  exact: Map<string, GitLetter>;
  lower: Map<string, GitLetter>;
  /** Пометки папок: их в порцелейне нет, а ссылка на папку — такой же узел карты. */
  folders: Map<string, GitLetter[]>;
};

type Watcher = { stop: () => void; listeners: Set<() => void> };

export type GitLookup = {
  /** Буква для файла по абсолютному пути; не репозиторий или нет пометки — `undefined`. */
  letterOf(path: string): GitLetter | undefined;
  /** Корни, задетые этим набором путей: по ним поднимается вотчер. */
  roots: string[];
  /** Почему пометок нет. Пусто — значит всё получилось; текст уходит в лог метрики. */
  log?: string;
};

export class GitStatus {
  /** Папка → репозиторий, которому она принадлежит. `undefined` значит «спрашивали, git нет». */
  private readonly byFolder = new Map<string, Repo | undefined>();
  private readonly byRoot = new Map<string, Repo>();
  private readonly marksOfRoot = new Map<string, Marks>();
  private readonly watchers = new Map<string, Watcher>();

  constructor(
    private readonly shell: ShellPort,
    private readonly watcher: FileWatcher,
    private readonly env: EnvPort,
    private readonly timers: TimersPort,
    private readonly clock: ClockPort,
  ) {}

  private now(): number {
    return Date.parse(this.clock.now());
  }

  /**
   * Корень и настоящий gitdir одной командой: у сабмодуля и у worktree `.git` — файл, и следить
   * за ним бесполезно. Подъём по файлам этого не видит вовсе, поэтому спрашиваем сам git.
   */
  private async repoOf(folder: string): Promise<Repo | undefined> {
    if (this.byFolder.has(folder)) return this.byFolder.get(folder);

    let repo: Repo | undefined;
    try {
      const { stdout } = await this.shell.run("git rev-parse --show-toplevel --absolute-git-dir", {
        cwd: folder,
        env: this.env.vars(),
      });
      const [root, gitDir] = stdout.trim().split("\n");
      if (root && gitDir) repo = { root: slash(root), gitDir: slash(gitDir) };
    } catch {
      // Папка вне git, git не установлен, каталога нет — всё это «пометок не будет», не поломка.
      repo = undefined;
    }

    this.byFolder.set(folder, repo);
    if (repo) this.byRoot.set(repo.root, repo);
    return repo;
  }

  private async marksOf(root: string): Promise<{ marks?: Marks; log?: string }> {
    const cached = this.marksOfRoot.get(root);
    if (cached && this.now() - cached.at < FRESH_MS) return { marks: cached };

    try {
      const { stdout } = await this.shell.run("git status --porcelain -z -uall", {
        cwd: root,
        env: this.env.vars(),
      });
      const exact = parsePorcelain(stdout);
      const lower = new Map([...exact].map(([path, letter]) => [path.toLowerCase(), letter]));
      const marks: Marks = { at: this.now(), exact, lower, folders: foldersOf(exact) };
      this.marksOfRoot.set(root, marks);
      return { marks };
    } catch (error) {
      // Упавший git молчит для интерфейса: прежние пометки остаются, причина уходит в лог.
      return {
        ...(cached ? { marks: cached } : {}),
        log: `git status в ${root}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Корни для набора путей. Обычно корень один на всю карту, поэтому уже известный корень-префикс
   * закрывает путь без вызова git — иначе дерево пакета стоило бы по вызову на папку.
   */
  private async reposFor(paths: string[]): Promise<Repo[]> {
    const repos: Repo[] = [];

    for (const path of paths) {
      if (repos.some((repo) => inside(repo.root, path))) continue;
      const folder = dirname(slash(path));
      if (!folder) continue;
      // oxlint-disable-next-line no-await-in-loop
      const repo = await this.repoOf(folder);
      if (repo && !repos.some((known) => known.root === repo.root)) repos.push(repo);
    }

    return repos;
  }

  /** Справочник на один прогон шага: собранные статусы плюс поиск по ним. */
  async lookup(paths: string[]): Promise<GitLookup> {
    const repos = await this.reposFor(paths);
    const logs: string[] = [];
    const collected: { root: string; marks: Marks }[] = [];

    for (const repo of repos) {
      // oxlint-disable-next-line no-await-in-loop
      const { marks, log } = await this.marksOf(repo.root);
      if (log) logs.push(log);
      if (marks) collected.push({ root: repo.root, marks });
    }

    return {
      roots: repos.map((repo) => repo.root),
      ...(logs.length > 0 ? { log: logs.join("\n") } : {}),
      letterOf(path: string) {
        const full = slash(path);
        for (const { root, marks } of collected) {
          if (!inside(root, full)) continue;
          const relative = full.slice(root.length + 1);
          // Точное совпадение сперва: на файловой системе, где регистр значим, README.md
          // и readme.md — разные файлы, и подменять одно другим нельзя. Не сошлось — путь может
          // оказаться папкой, и тогда отвечает то, что внутри.
          const own = marks.exact.get(relative) ?? marks.lower.get(relative.toLowerCase());
          if (own) return own;
          const inFolder = marks.folders.get(relative);
          return inFolder ? strongest(inFolder) : undefined;
        }
        return undefined;
      },
    };
  }

  /**
   * Вотчер на репозиторий: следим за `.git/index` и `.git/HEAD` — первый меняется на каждый
   * `add`, `commit` и правку рабочего дерева через git, второй на смене ветки.
   *
   * Подписчиков на корень бывает много — по метрике с шагом на каждом открытом объекте, —
   * а вотчер на корень один; уходит последний, гаснет и он.
   */
  watchRoots(roots: string[], onChange: () => void): () => void {
    const held: string[] = [];

    for (const root of roots) {
      const repo = this.byRoot.get(root);
      if (!repo) continue;

      const watcher = this.watchers.get(root);
      if (watcher) {
        watcher.listeners.add(onChange);
      } else {
        const listeners = new Set<() => void>([onChange]);
        const beat = debounce(this.timers, this.clock, QUIET_MS, () => {
          // Статус пересобирается следующим прогоном шага; здесь только снимаем свежесть.
          this.marksOfRoot.delete(root);
          for (const listener of listeners) listener();
        });
        const stop = this.watcher.watch(repo.gitDir, () => beat.tick(), {
          include: ["index", "HEAD"],
        });
        this.watchers.set(root, {
          listeners,
          stop: () => {
            beat.cancel();
            stop();
          },
        });
      }
      held.push(root);
    }

    return () => {
      for (const root of held) {
        const watcher = this.watchers.get(root);
        if (!watcher) continue;
        watcher.listeners.delete(onChange);
        if (watcher.listeners.size > 0) continue;
        watcher.stop();
        this.watchers.delete(root);
      }
    };
  }

  /** Только корни, без статуса: вотчеру нужно знать, за чем следить, а не что сейчас изменено. */
  async roots(paths: string[]): Promise<string[]> {
    return (await this.reposFor(paths)).map((repo) => repo.root);
  }
}

const inside = (root: string, path: string): boolean =>
  path.toLowerCase().startsWith(`${root.toLowerCase()}/`);
