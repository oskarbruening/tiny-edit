import type * as Fs from "node:fs";
import { defaultState, parseState, type AppState } from "../shared/state";
import { writeAtomic, writeAtomicSync, type AtomicFs } from "./atomicWrite";

export type StateFs = AtomicFs & Pick<typeof Fs, "readFileSync" | "existsSync">;

export type StateStoreOptions = {
  filePath: string;
  fs: StateFs;
  debounceMs?: number;
  /** For the corrupt-file rename; injectable for tests. */
  now?: () => Date;
  onError?: (err: unknown) => void;
};

/**
 * Owns userData/state.json. load() once at startup (sync), patch() from anywhere
 * (debounced async atomic write), flush() synchronously before quit.
 */
export class StateStore {
  private state: AppState = defaultState();
  private lastWritten = "";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly debounceMs: number;
  private readonly now: () => Date;
  private readonly onError: (err: unknown) => void;
  private readonly listeners = new Set<(state: AppState) => void>();

  constructor(private readonly opts: StateStoreOptions) {
    this.debounceMs = opts.debounceMs ?? 250;
    this.now = opts.now ?? (() => new Date());
    this.onError = opts.onError ?? ((err) => console.error("[state]", err));
  }

  /** Reads and parses the file. Missing → defaults. Unparseable → renamed aside, defaults. */
  load(): AppState {
    const { fs, filePath } = this.opts;
    if (!fs.existsSync(filePath)) {
      this.state = defaultState();
      this.lastWritten = this.serialize(); // nothing to write until something changes
      return this.state;
    }
    try {
      const text = fs.readFileSync(filePath, "utf8");
      this.state = parseState(JSON.parse(text));
      this.lastWritten = text;
    } catch (err) {
      this.onError(err);
      const aside = `${filePath}.corrupt-${this.now().toISOString().replace(/[:.]/g, "-")}`;
      try {
        fs.renameSync(filePath, aside);
      } catch (renameErr) {
        this.onError(renameErr);
      }
      this.state = defaultState();
      this.lastWritten = this.serialize();
    }
    return this.state;
  }

  get(): AppState {
    return this.state;
  }

  /** Merges a (pre-validated) partial state and schedules a write. */
  patch(partial: Partial<AppState>): AppState {
    this.state = { ...this.state, ...partial, version: this.state.version };
    this.schedule();
    for (const fn of this.listeners) fn(this.state);
    return this.state;
  }

  /** Called after every patch (not on load). Returns an unsubscribe function. */
  subscribe(fn: (state: AppState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.writeNow();
    }, this.debounceMs);
  }

  private serialize(): string {
    return JSON.stringify(this.state, null, 2) + "\n";
  }

  private async writeNow(): Promise<void> {
    const text = this.serialize();
    if (text === this.lastWritten) return;
    try {
      await writeAtomic(this.opts.fs, this.opts.filePath, text);
      this.lastWritten = text;
    } catch (err) {
      this.onError(err);
    }
  }

  /** Cancels any pending write and writes synchronously if anything changed. */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const text = this.serialize();
    if (text === this.lastWritten) return;
    try {
      writeAtomicSync(this.opts.fs, this.opts.filePath, text);
      this.lastWritten = text;
    } catch (err) {
      this.onError(err);
    }
  }

  /** True while a debounced write is pending (for tests and quit handling). */
  get dirty(): boolean {
    return this.timer !== null || this.serialize() !== this.lastWritten;
  }
}
