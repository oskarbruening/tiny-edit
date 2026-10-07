import { basename, dirname } from "node:path";
import type { FileStamp } from "./files";
import { sameStamp } from "./files";

export type WatchHandle = { close(): void };
export type WatchFn = (
  dir: string,
  listener: (eventType: string, filename: string | Buffer | null) => void,
) => WatchHandle;

export type WatcherDeps = {
  /** fs.watch (injectable). */
  watch: WatchFn;
  /** Current stamp or null when the file is gone (Files.stat). */
  stat: (path: string) => Promise<FileStamp | null>;
  onChanged: (path: string, stamp: FileStamp) => void;
  onMissing: (path: string) => void;
  onError?: (err: unknown) => void;
  debounceMs?: number;
};

/**
 * Watches the parent directory of every listed file (atomic-save editors replace the
 * inode, so watching the file itself breaks), debounces, then re-stats and compares with
 * the stamp the renderer already holds. Our own writes are recorded via `recordStamp`
 * so they never bounce back as changes. `checkAll` is the belt-and-braces re-stat on focus.
 */
export class Watcher {
  private readonly dirs = new Map<string, { handle: WatchHandle | null; files: Set<string> }>();
  private readonly known = new Map<string, FileStamp | null>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly debounceMs: number;
  private readonly onError: (err: unknown) => void;
  private closed = false;

  constructor(private readonly deps: WatcherDeps) {
    this.debounceMs = deps.debounceMs ?? 150;
    this.onError = deps.onError ?? ((err) => console.error("[watcher]", err));
  }

  /** Replace the watched set. Directories no longer needed are closed; new ones opened. */
  setPaths(paths: readonly string[]): void {
    const wanted = new Map<string, Set<string>>();
    for (const p of paths) {
      const dir = dirname(p);
      (wanted.get(dir) ?? wanted.set(dir, new Set()).get(dir)!).add(basename(p));
    }
    for (const [dir, entry] of this.dirs) {
      if (!wanted.has(dir)) {
        entry.handle?.close();
        this.dirs.delete(dir);
      }
    }
    for (const [dir, files] of wanted) {
      const entry = this.dirs.get(dir);
      if (entry) entry.files = files;
      else this.dirs.set(dir, { handle: this.open(dir), files });
    }
    const keep = new Set(paths);
    for (const p of this.known.keys()) if (!keep.has(p)) this.known.delete(p);
  }

  /** The renderer now holds this stamp (after read or write). */
  recordStamp(path: string, stamp: FileStamp): void {
    this.known.set(path, stamp);
  }

  /** Re-stat everything (window focus, missed events). */
  async checkAll(): Promise<void> {
    const paths: string[] = [];
    for (const [dir, entry] of this.dirs) for (const name of entry.files) paths.push(`${dir}/${name}`);
    await Promise.all(paths.map((p) => this.check(p)));
  }

  close(): void {
    this.closed = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const entry of this.dirs.values()) entry.handle?.close();
    this.dirs.clear();
  }

  private open(dir: string): WatchHandle | null {
    try {
      return this.deps.watch(dir, (_type, filename) => this.onEvent(dir, filename));
    } catch (err) {
      this.onError(err);
      return null;
    }
  }

  private onEvent(dir: string, filename: string | Buffer | null): void {
    const entry = this.dirs.get(dir);
    if (!entry) return;
    const name = filename === null ? null : filename.toString();
    const names = name === null ? [...entry.files] : entry.files.has(name) ? [name] : [];
    for (const n of names) this.schedule(`${dir}/${n}`);
  }

  private schedule(path: string): void {
    const existing = this.timers.get(path);
    if (existing) clearTimeout(existing);
    this.timers.set(
      path,
      setTimeout(() => {
        this.timers.delete(path);
        void this.check(path);
      }, this.debounceMs),
    );
  }

  private async check(path: string): Promise<void> {
    if (this.closed) return;
    let stamp: FileStamp | null;
    try {
      stamp = await this.deps.stat(path);
    } catch (err) {
      this.onError(err);
      return;
    }
    if (this.closed) return;
    const previous = this.known.get(path);
    if (stamp === null) {
      if (previous !== null) {
        this.known.set(path, null);
        this.deps.onMissing(path);
      }
      return;
    }
    if (previous === undefined || previous === null || !sameStamp(previous, stamp)) {
      this.known.set(path, stamp);
      if (previous !== undefined) this.deps.onChanged(path, stamp);
    }
  }
}
