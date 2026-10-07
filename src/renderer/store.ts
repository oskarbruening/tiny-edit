import type { AppState, FileState, StatePatch } from "../shared/state";

export type FileView = Pick<FileState, "anchor" | "head" | "scrollTop">;
export type Listener = (state: AppState) => void;

/**
 * Renderer-side copy of the persisted state. Patches apply locally first (so the UI
 * never waits on IPC) and are forwarded to main, which validates and persists them.
 */
export class Store {
  private state: AppState;
  private readonly listeners = new Set<Listener>();

  constructor(
    initial: AppState,
    private readonly persist: (patch: StatePatch) => Promise<AppState>,
    private readonly onError: (err: unknown) => void = (err) => console.error("[store]", err),
  ) {
    this.state = initial;
  }

  get(): AppState {
    return this.state;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Replace wholesale with main's authoritative copy (after files were added elsewhere). */
  replace(state: AppState): void {
    this.state = state;
    this.emit();
  }

  patch(patch: StatePatch): void {
    this.state = { ...this.state, ...patch };
    this.emit();
    this.persist(patch).catch(this.onError);
  }

  fileState(path: string): FileState | undefined {
    return this.state.files.find((f) => f.path === path);
  }

  /** Records caret/scroll for a listed file. Unlisted paths are ignored. */
  setFileView(path: string, view: FileView): void {
    const current = this.fileState(path);
    if (!current) return;
    if (current.anchor === view.anchor && current.head === view.head && current.scrollTop === view.scrollTop)
      return;
    this.patch({ files: this.state.files.map((f) => (f.path === path ? { ...f, ...view } : f)) });
  }

  setActive(path: string | null): void {
    if (this.state.activePath !== path) this.patch({ activePath: path });
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}
