import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { FileView } from "../store";
import { editorExtensions } from "./extensions";

export type EditorHooks = {
  /** Caret/scroll settled (debounced) — persist it. */
  onViewChange: (path: string, view: FileView) => void;
  /** The document changed — schedule a save. */
  onDocChange: (path: string) => void;
};

export type EditorOptions = {
  hooks: EditorHooks;
  viewDebounceMs?: number;
  extensions?: readonly Extension[];
  /** Focus the editor after opening a file (default true; tests turn it off). */
  autoFocus?: boolean;
};

/**
 * One EditorView, one EditorState per open file. Switching files swaps states so undo
 * history and unsaved edits survive; opening a file again reuses its state.
 */
export class Editor {
  readonly view: EditorView;
  private readonly states = new Map<string, EditorState>();
  private current: string | null = null;
  private viewTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly viewDebounceMs: number;

  constructor(
    host: HTMLElement,
    private readonly opts: EditorOptions,
  ) {
    this.viewDebounceMs = opts.viewDebounceMs ?? 300;
    this.view = new EditorView({
      parent: host,
      state: this.blankState(),
    });
    this.view.scrollDOM.addEventListener("scroll", () => this.scheduleViewChange());
  }

  get currentPath(): string | null {
    return this.current;
  }

  /** Shows `path`. Reuses the existing state for the file when it is already open. */
  open(path: string, text: string, saved?: FileView): void {
    this.flushViewChange();
    if (this.current) this.states.set(this.current, this.view.state);
    const state = this.states.get(path) ?? this.freshState(path, text, saved);
    this.current = path;
    this.view.setState(state);
    const top = this.states.has(path) ? this.view.scrollDOM.scrollTop : (saved?.scrollTop ?? 0);
    this.states.set(path, state);
    requestAnimationFrame(() => {
      this.view.scrollDOM.scrollTop = top;
      if (this.opts.autoFocus !== false && !focusIsElsewhere(this.view)) this.view.focus();
    });
  }

  /** Replaces the document of an open file (external change) keeping the caret where it was, clamped. */
  replaceText(path: string, text: string): void {
    const state = path === this.current ? this.view.state : this.states.get(path);
    if (!state) return;
    const sel = state.selection.main;
    const next = EditorState.create({
      doc: text,
      selection: EditorSelection.single(Math.min(sel.anchor, text.length), Math.min(sel.head, text.length)),
      extensions: this.extensions(path),
    });
    if (path === this.current) {
      const top = this.view.scrollDOM.scrollTop;
      this.view.setState(next);
      requestAnimationFrame(() => (this.view.scrollDOM.scrollTop = top));
    }
    this.states.set(path, next);
  }

  /** Current text of a file, or null if it is not open. */
  text(path: string): string | null {
    if (path === this.current) return this.view.state.doc.toString();
    return this.states.get(path)?.doc.toString() ?? null;
  }

  /** Caret/scroll of the active file. */
  currentView(): FileView {
    const sel = this.view.state.selection.main;
    return { anchor: sel.anchor, head: sel.head, scrollTop: Math.round(this.view.scrollDOM.scrollTop) };
  }

  /** Forgets a file (removed from the list). Clears the editor if it was active. */
  close(path: string): void {
    this.states.delete(path);
    if (this.current === path) {
      this.current = null;
      this.view.setState(this.blankState());
    }
  }

  isOpen(path: string): boolean {
    return this.states.has(path);
  }

  destroy(): void {
    if (this.viewTimer) clearTimeout(this.viewTimer);
    this.view.destroy();
  }

  /** Extensions for one file's state; the listener knows its path, so no lookup is needed. */
  private extensions(path: string): Extension[] {
    return editorExtensions([
      EditorView.updateListener.of((update) => {
        if (update.docChanged) this.opts.hooks.onDocChange(path);
        // selectionSet is also true for CodeMirror's own focus/measure transactions; only
        // an actual change of caret or text counts as activity worth persisting.
        if (update.docChanged || !update.startState.selection.eq(update.state.selection))
          this.scheduleViewChange();
      }),
      ...(this.opts.extensions ?? []),
    ]);
  }

  private freshState(path: string, text: string, saved?: FileView): EditorState {
    const anchor = Math.min(saved?.anchor ?? 0, text.length);
    const head = Math.min(saved?.head ?? anchor, text.length);
    return EditorState.create({
      doc: text,
      selection: EditorSelection.single(anchor, head),
      extensions: this.extensions(path),
    });
  }

  private blankState(): EditorState {
    return EditorState.create({
      doc: "",
      extensions: [...editorExtensions(), EditorState.readOnly.of(true)],
    });
  }

  private scheduleViewChange(): void {
    if (this.viewTimer) clearTimeout(this.viewTimer);
    this.viewTimer = setTimeout(() => this.flushViewChange(), this.viewDebounceMs);
  }

  private flushViewChange(): void {
    if (this.viewTimer) {
      clearTimeout(this.viewTimer);
      this.viewTimer = null;
    }
    if (this.current) this.opts.hooks.onViewChange(this.current, this.currentView());
  }
}

/** True when another form control (e.g. the sidebar's new-file field or the search panel) owns focus. */
function focusIsElsewhere(view: EditorView): boolean {
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  if (view.dom.contains(active)) return false;
  return (
    active instanceof HTMLInputElement ||
    active instanceof HTMLTextAreaElement ||
    (active as HTMLElement).isContentEditable
  );
}
