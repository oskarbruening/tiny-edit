import type { Api, FileStamp, WriteFileRequest } from "../shared/ipc";
import type { Eol } from "../shared/text";

/** What we know about a file on disk; `stamp` null means "not there when we last looked". */
export type FileMeta = { eol: Eol; bom: boolean; stamp: FileStamp | null };

export type AutosaveDeps = {
  api: Pick<Api, "writeFile">;
  /** Current editor text, or null if the file is not open. */
  text: (path: string) => string | null;
  meta: Map<string, FileMeta>;
  onSaved: (path: string, stamp: FileStamp) => void;
  onConflict: (path: string, onDisk: FileStamp) => void;
  onError: (path: string, err: unknown) => void;
  idleMs?: number;
};

/**
 * Debounced writer. One write in flight per file; edits during a write re-queue it. A
 * conflicting file is parked until `resolve()` so we never spam the guard or overwrite.
 */
export class Autosave {
  private readonly dirty = new Set<string>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly parked = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleMs: number;

  constructor(private readonly deps: AutosaveDeps) {
    this.idleMs = deps.idleMs ?? 300;
  }

  /** The document changed; save after the idle period. */
  markDirty(path: string): void {
    this.dirty.add(path);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.idleMs);
  }

  isDirty(path: string): boolean {
    return this.dirty.has(path) || this.inFlight.has(path);
  }

  isParked(path: string): boolean {
    return this.parked.has(path);
  }

  /** The disk changed under unsaved edits (watcher): hold writes until the user decides. */
  park(path: string): void {
    this.parked.add(path);
  }

  /** Forget a file (removed from the list). */
  forget(path: string): void {
    this.dirty.delete(path);
    this.parked.delete(path);
  }

  /** The conflict was resolved: either write ours over the disk version or drop our edits. */
  async resolve(path: string, how: "keep-mine" | "reload"): Promise<void> {
    this.parked.delete(path);
    if (how === "keep-mine") await this.write(path, true);
    else this.dirty.delete(path);
  }

  /** Writes everything dirty (or one path) now. Resolves when the writes are done. */
  async flush(path?: string): Promise<void> {
    if (this.timer && path === undefined) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const targets = path === undefined ? [...this.dirty] : this.dirty.has(path) ? [path] : [];
    await Promise.all(targets.map((p) => this.write(p, false)));
    await Promise.all([...this.inFlight.values()]);
  }

  private write(path: string, force: boolean): Promise<void> {
    const running = this.inFlight.get(path);
    if (running) return running.then(() => (this.dirty.has(path) ? this.write(path, force) : undefined));
    if (this.parked.has(path) && !force) return Promise.resolve();
    const text = this.deps.text(path);
    if (text === null) {
      this.dirty.delete(path);
      return Promise.resolve();
    }
    const meta = this.deps.meta.get(path) ?? { eol: "\n", bom: false, stamp: null };
    this.dirty.delete(path);
    const req: WriteFileRequest = { path, text, eol: meta.eol, bom: meta.bom, expected: meta.stamp, force };
    const job = this.deps.api
      .writeFile(req)
      .then((result) => {
        if (result.ok) {
          this.deps.meta.set(path, { ...meta, stamp: result.stamp });
          this.deps.onSaved(path, result.stamp);
        } else {
          this.parked.add(path);
          this.dirty.add(path);
          this.deps.onConflict(path, result.conflict);
        }
      })
      .catch((err: unknown) => {
        this.dirty.add(path);
        this.deps.onError(path, err);
      })
      .finally(() => this.inFlight.delete(path));
    this.inFlight.set(path, job);
    return job;
  }
}
