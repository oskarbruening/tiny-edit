import { EditorSelection, EditorState, Transaction, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { FileView } from "../store";
import { editorExtensions } from "./extensions";
import { topLanguage } from "./languages";
import { externalReload, scopeField, setScope, type ScopeRange } from "./scope";

export type EditorHooks = {
  /** Caret/scroll settled (debounced) — persist it. */
  onViewChange: (path: string, view: FileView) => void;
  /** The document changed by the user's hand — schedule a save. Disk reloads do not count. */
  onDocChange: (path: string) => void;
};

export type EditorOptions = {
  hooks: EditorHooks;
  viewDebounceMs?: number;
  extensions?: readonly Extension[];
  /** Focus the editor after opening a file (default true; tests turn it off). */
  autoFocus?: boolean;
  /** Read-only Markdown shown when no file is open (the welcome page). */
  placeholder?: string;
};

export type OpenOptions = {
  /** The file cannot be edited (its bytes are not valid UTF-8, so a write would be lossy). */
  readOnly?: boolean;
};

/** The smallest single change turning `from` into `to`: common prefix and suffix trimmed. */
export function minimalChange(from: string, to: string): { from: number; to: number; insert: string } | null {
  if (from === to) return null;
  let prefix = 0;
  const max = Math.min(from.length, to.length);
  while (prefix < max && from.charCodeAt(prefix) === to.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    from.charCodeAt(from.length - 1 - suffix) === to.charCodeAt(to.length - 1 - suffix)
  )
    suffix++;
  return { from: prefix, to: from.length - suffix, insert: to.slice(prefix, to.length - suffix) };
}

/**
 * One EditorView, one EditorState per open file. Switching files swaps states so undo
 * history and unsaved edits survive; opening a file again reuses its state and scroll
 * position. With no file open the view shows a read-only page (the welcome page, or What's New).
 */
export class Editor {
  readonly view: EditorView;
  private readonly states = new Map<string, EditorState>();
  /** Scroll offset of every open file, recorded when the view moves away from it. */
  private readonly scrollTops = new Map<string, number>();
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
      state: this.pageState(opts.placeholder ?? ""),
    });
    this.view.scrollDOM.addEventListener("scroll", () => this.scheduleViewChange());
  }

  get currentPath(): string | null {
    return this.current;
  }

  /** Shows `path`. Reuses the existing state (and scroll position) for a file that is already open. */
  open(path: string, text: string, saved?: FileView, options: OpenOptions = {}): void {
    this.park();
    const state = this.states.get(path) ?? this.freshState(path, text, saved, options);
    const top = this.scrollTops.get(path) ?? saved?.scrollTop ?? 0;
    this.current = path;
    this.view.setState(state);
    this.states.set(path, state);
    requestAnimationFrame(() => {
      this.view.scrollDOM.scrollTop = top;
      if (this.opts.autoFocus !== false && !focusIsElsewhere(this.view)) this.view.focus();
    });
  }

  /**
   * Replaces an open file's document with the disk version as one minimal change, so the
   * caret, the scope and the undo history map through it instead of being thrown away.
   * Not a user edit: `onDocChange` is not called and autosave stays quiet.
   */
  replaceText(path: string, text: string): void {
    const state = path === this.current ? this.view.state : this.states.get(path);
    if (!state) return;
    const change = minimalChange(state.doc.toString(), text);
    if (!change) return;
    const spec = {
      changes: change,
      annotations: [externalReload.of(true), Transaction.addToHistory.of(false)],
    };
    if (path === this.current) {
      const top = this.view.scrollDOM.scrollTop;
      this.view.dispatch(spec);
      requestAnimationFrame(() => (this.view.scrollDOM.scrollTop = top));
    } else this.states.set(path, state.update(spec).state);
  }

  /**
   * Replaces the active file's whole document with its pretty-formatted text (Edit → Pretty
   * Format). Unlike `replaceText`, this is a real user edit: it goes on the undo history (Cmd+Z
   * reverts it) and triggers autosave. Any section scope is cleared first so the whole file is
   * written, since the formatter reflows the entire document. Returns false when `path` is not
   * active or the text is already formatted (nothing to do).
   */
  formatDocument(path: string, text: string): boolean {
    if (path !== this.current) return false;
    // A narrowed section would block a full-document edit (scope's change filter), so clear it first.
    if (this.view.state.field(scopeField, false)) this.view.dispatch({ effects: setScope.of(null) });
    const change = minimalChange(this.view.state.doc.toString(), text);
    if (!change) return false;
    this.view.dispatch({ changes: change, scrollIntoView: true });
    return true;
  }

  /** Current text of a file, or null if it is not open. */
  text(path: string): string | null {
    if (path === this.current) return this.view.state.doc.toString();
    return this.states.get(path)?.doc.toString() ?? null;
  }

  /**
   * Narrow the active file to a section (or clear with `null`). The whole document stays in the
   * buffer; only the visible range changes. Puts the caret at the section start and scrolls to it.
   */
  applyScope(path: string, range: ScopeRange | null): void {
    if (path !== this.current) return;
    const length = this.view.state.doc.length;
    const scope =
      range && range.from < range.to
        ? { from: Math.max(0, Math.min(range.from, length)), to: Math.max(0, Math.min(range.to, length)) }
        : null;
    this.view.dispatch({
      effects: setScope.of(scope && scope.from < scope.to ? scope : null),
      // Only move the caret and scroll when narrowing; clearing must not disturb a restored scroll.
      ...(scope ? { selection: EditorSelection.single(scope.from), scrollIntoView: true } : {}),
    });
  }

  /** The scoped range of a file, or null when it shows the whole document. */
  scopeOf(path: string): ScopeRange | null {
    const state = path === this.current ? this.view.state : this.states.get(path);
    return state?.field(scopeField, false) ?? null;
  }

  /** Caret/scroll of the active file. */
  currentView(): FileView {
    const sel = this.view.state.selection.main;
    return { anchor: sel.anchor, head: sel.head, scrollTop: Math.round(this.view.scrollDOM.scrollTop) };
  }

  /** Forgets a file (removed from the list). Shows the placeholder page if it was active. */
  close(path: string): void {
    this.states.delete(path);
    this.scrollTops.delete(path);
    if (this.current !== path) return;
    this.current = null; // so showPage does not store the closed file's state again
    this.showPage(this.opts.placeholder ?? "");
  }

  /**
   * Shows bundled read-only Markdown instead of a file (welcome page, What's New). The active
   * file's state is kept, so opening it again restores its text, undo history, caret and scroll.
   */
  showPage(text: string): void {
    this.park();
    this.current = null;
    this.view.setState(this.pageState(text));
    this.view.scrollDOM.scrollTop = 0;
  }

  isOpen(path: string): boolean {
    return this.states.has(path);
  }

  destroy(): void {
    if (this.viewTimer) clearTimeout(this.viewTimer);
    this.view.destroy();
  }

  /** Persist the current file's view and remember its state and scroll before the view moves on. */
  private park(): void {
    this.flushViewChange();
    if (this.current) {
      this.states.set(this.current, this.view.state);
      this.scrollTops.set(this.current, this.view.scrollDOM.scrollTop);
    }
  }

  /** Extensions for one file's state; the listener knows its path, so no lookup is needed. */
  private extensions(path: string, options: OpenOptions): Extension[] {
    return editorExtensions(
      [
        EditorView.updateListener.of((update) => {
          const userEdit =
            update.docChanged && !update.transactions.every((tr) => tr.annotation(externalReload));
          if (userEdit) this.opts.hooks.onDocChange(path);
          // selectionSet is also true for CodeMirror's own focus/measure transactions; only
          // an actual change of caret or text counts as activity worth persisting.
          if (update.docChanged || !update.startState.selection.eq(update.state.selection))
            this.scheduleViewChange();
        }),
        ...(options.readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
        ...(this.opts.extensions ?? []),
      ],
      topLanguage(path),
    );
  }

  private freshState(path: string, text: string, saved?: FileView, options: OpenOptions = {}): EditorState {
    const anchor = Math.min(saved?.anchor ?? 0, text.length);
    const head = Math.min(saved?.head ?? anchor, text.length);
    return EditorState.create({
      doc: text,
      selection: EditorSelection.single(anchor, head),
      extensions: this.extensions(path, options),
    });
  }

  /** Read-only page: same highlighting, copy and link buttons as a file, but no save/view hooks. */
  private pageState(text: string): EditorState {
    return EditorState.create({
      doc: text,
      extensions: [...editorExtensions(), ...(this.opts.extensions ?? []), EditorState.readOnly.of(true)],
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
