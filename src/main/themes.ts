import type * as Fs from "node:fs";
import { basename, join } from "node:path";
import { parseUserTheme, type Theme } from "../shared/themes";

export type ThemesFs = {
  promises: Pick<typeof Fs.promises, "readdir" | "readFile" | "mkdir">;
  watch: (dir: string, listener: () => void) => { close(): void };
};

export type UserThemesDeps = {
  dir: string;
  fs: ThemesFs;
  onChange: (themes: Theme[]) => void;
  onError?: (err: unknown) => void;
  debounceMs?: number;
};

/** `userData/themes/*.json`, hot-reloaded. Invalid files are skipped and reported, never fatal. */
export class UserThemes {
  private themes: Theme[] = [];
  private handle: { close(): void } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onError: (err: unknown) => void;

  constructor(private readonly deps: UserThemesDeps) {
    this.onError = deps.onError ?? ((err) => console.warn("[themes]", err));
  }

  get current(): readonly Theme[] {
    return this.themes;
  }

  /** Creates the folder if needed, loads every *.json, starts watching. */
  async start(): Promise<Theme[]> {
    await this.deps.fs.promises.mkdir(this.deps.dir, { recursive: true }).catch(this.onError);
    this.themes = await this.load();
    try {
      this.handle = this.deps.fs.watch(this.deps.dir, () => this.schedule());
    } catch (err) {
      this.onError(err);
    }
    return this.themes;
  }

  async load(): Promise<Theme[]> {
    const names = await this.deps.fs.promises.readdir(this.deps.dir).then(
      (all) => all.filter((n) => n.toLowerCase().endsWith(".json") && !n.startsWith(".")),
      (err: unknown) => {
        this.onError(err);
        return null;
      },
    );
    if (!names) return [];
    const out: Theme[] = [];
    const seen = new Set<string>();
    for (const name of names.sort()) {
      const path = join(this.deps.dir, name);
      try {
        const theme = parseUserTheme(
          JSON.parse(await this.deps.fs.promises.readFile(path, "utf8")),
          basename(name, ".json"),
        );
        if (!theme) this.onError(new Error(`${name}: unusable theme id`));
        else if (seen.has(theme.id)) this.onError(new Error(`${name}: duplicate theme id ${theme.id}`));
        else {
          seen.add(theme.id);
          out.push(theme);
        }
      } catch (err) {
        this.onError(new Error(`${name}: ${(err as Error).message}`));
      }
    }
    return out;
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.handle?.close();
    this.handle = null;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.load().then((themes) => {
        this.themes = themes;
        this.deps.onChange(themes);
      });
    }, this.deps.debounceMs ?? 200);
  }
}
