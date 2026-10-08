import type { FileState } from "../../shared/state";
import { displayName } from "../../shared/text";
import { hasOutline, type Heading } from "../../shared/toc";

export type TocMap = ReadonlyMap<string, readonly Heading[]>;
/** The scoped range of the active file, so the matching outline item can be marked current. */
export type ActiveScope = { from: number; to: number } | null;

export type SidebarProps = {
  onSelect: (path: string) => void;
  onContextMenu?: (path: string) => void;
  onCreate?: (name: string) => Promise<string | null>;
  /** An outline item was clicked: show that file's heading section (index into its TOC). */
  onSelectHeading?: (path: string, index: number) => void;
  /** `path` was dropped before/after `target` (both listed). */
  onReorder?: (path: string, target: string, position: "before" | "after") => void;
};

/** Internal drag type so a sidebar reorder is never mistaken for a Finder drop (and vice versa). */
export const REORDER_MIME = "application/x-tiny-edit-path";

/** Pure: the list after moving `path` next to `target`. Unknown paths or a self-drop leave it unchanged. */
export function reorder<T extends { path: string }>(
  files: readonly T[],
  path: string,
  target: string,
  position: "before" | "after",
): T[] {
  if (path === target) return [...files];
  const moving = files.find((f) => f.path === path);
  const rest = files.filter((f) => f.path !== path);
  const index = rest.findIndex((f) => f.path === target);
  if (!moving || index === -1) return [...files];
  const at = position === "before" ? index : index + 1;
  return [...rest.slice(0, at), moving, ...rest.slice(at)];
}

/** The file list. Pure rendering from props; drops and reordering are wired by app.ts. */
export class Sidebar {
  private files: readonly FileState[] = [];
  private activePath: string | null = null;
  private missing: ReadonlySet<string> = new Set();
  private tocs: TocMap = new Map();
  private activeScope: ActiveScope = null;
  /** Paths whose outline is expanded in the list. Kept across renders. */
  private readonly expanded = new Set<string>();
  private creating: { input: HTMLInputElement; error: HTMLElement } | null = null;
  /** True while render() swaps nodes; a blur caused by that swap must not cancel the input. */
  private rendering = false;

  constructor(
    private readonly list: HTMLElement,
    private readonly props: SidebarProps,
  ) {
    list.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const chevron = target.closest<HTMLElement>(".sidebar__chevron");
      if (chevron) {
        const path = chevron.closest<HTMLElement>("[data-path]")?.dataset["path"];
        if (path) this.toggleToc(path);
        return;
      }
      const tocItem = target.closest<HTMLElement>(".sidebar__toc-item");
      if (tocItem) {
        const path = tocItem.closest<HTMLElement>("[data-path]")?.dataset["path"];
        const index = Number(tocItem.dataset["headIndex"]);
        if (path && Number.isInteger(index)) this.props.onSelectHeading?.(path, index);
        return;
      }
      const path = target.closest<HTMLElement>("[data-path]")?.dataset["path"];
      if (path) this.props.onSelect(path);
    });
    list.addEventListener("dragstart", (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>("[data-path]");
      if (!item?.dataset["path"] || !e.dataTransfer) return;
      e.dataTransfer.setData(REORDER_MIME, item.dataset["path"]);
      e.dataTransfer.effectAllowed = "move";
      item.classList.add("is-dragging");
    });
    list.addEventListener("dragover", (e) => {
      const item = this.reorderTarget(e);
      this.clearDropMarks();
      if (!item) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      item.classList.add(this.dropPosition(e, item) === "before" ? "is-drop-before" : "is-drop-after");
    });
    list.addEventListener("dragleave", () => this.clearDropMarks());
    list.addEventListener("drop", (e) => {
      const item = this.reorderTarget(e);
      this.clearDropMarks();
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      const path = e.dataTransfer!.getData(REORDER_MIME);
      const target = item.dataset["path"]!;
      if (path && path !== target) this.props.onReorder?.(path, target, this.dropPosition(e, item));
    });
    list.addEventListener("dragend", () => {
      this.clearDropMarks();
      for (const el of list.querySelectorAll(".is-dragging")) el.classList.remove("is-dragging");
    });
    list.addEventListener("contextmenu", (e) => {
      const item = (e.target as HTMLElement).closest<HTMLElement>("[data-path]");
      if (item?.dataset["path"]) {
        e.preventDefault();
        this.props.onContextMenu?.(item.dataset["path"]);
      }
    });
  }

  render(
    files: readonly FileState[],
    activePath: string | null,
    missing: ReadonlySet<string>,
    tocs: TocMap = new Map(),
    activeScope: ActiveScope = null,
  ): void {
    this.files = files;
    this.activePath = activePath;
    this.missing = missing;
    this.tocs = tocs;
    this.activeScope = activeScope;
    const nodes: HTMLElement[] = [];
    if (files.length === 0 && !this.creating) {
      const empty = document.createElement("li");
      empty.className = "sidebar__empty";
      empty.innerHTML = "Drop .md or .txt files here<br />⌘N new file";
      nodes.push(empty);
    }
    for (const f of files) nodes.push(this.fileItem(f, activePath));
    if (this.creating) nodes.push(this.creating.input.parentElement as HTMLElement);
    const refocus = this.creating !== null && document.activeElement === this.creating.input;
    this.rendering = true;
    this.list.replaceChildren(...nodes);
    this.rendering = false;
    if (refocus) this.creating!.input.focus();
  }

  /** One file: a name row (with an outline chevron when it has a TOC) and the expanded outline. */
  private fileItem(f: FileState, activePath: string | null): HTMLElement {
    const li = document.createElement("li");
    li.className = "sidebar__item";
    if (f.path === activePath) li.classList.add("is-active");
    if (this.missing.has(f.path)) li.classList.add("is-missing");
    li.dataset["path"] = f.path;
    li.title = f.path;
    li.draggable = true;

    const row = document.createElement("div");
    row.className = "sidebar__row";
    const name = document.createElement("span");
    name.className = "sidebar__name";
    name.textContent = displayName(f.path);
    row.append(name);

    const headings = this.tocs.get(f.path) ?? [];
    const outline = hasOutline(headings);
    if (outline) {
      const chevron = document.createElement("button");
      chevron.type = "button";
      chevron.className = "sidebar__chevron";
      chevron.setAttribute("aria-label", "Toggle outline");
      chevron.setAttribute("aria-expanded", String(this.expanded.has(f.path)));
      chevron.textContent = "›";
      if (this.expanded.has(f.path)) chevron.classList.add("is-expanded");
      row.append(chevron);
    }
    li.append(row);

    if (outline && this.expanded.has(f.path)) li.append(this.outline(f.path, headings, activePath));
    return li;
  }

  private outline(path: string, headings: readonly Heading[], activePath: string | null): HTMLElement {
    const ul = document.createElement("ul");
    ul.className = "sidebar__toc";
    headings.forEach((h, index) => {
      const item = document.createElement("li");
      item.className = `sidebar__toc-item ${h.level === 2 ? "is-h2" : "is-h1"}`;
      item.dataset["headIndex"] = String(index);
      item.textContent = h.text || "(untitled)";
      if (
        path === activePath &&
        this.activeScope &&
        h.from === this.activeScope.from &&
        h.to === this.activeScope.to
      )
        item.classList.add("is-current");
      ul.append(item);
    });
    return ul;
  }

  private toggleToc(path: string): void {
    if (!this.expanded.delete(path)) this.expanded.add(path);
    this.render(this.files, this.activePath, this.missing, this.tocs, this.activeScope);
  }

  /** Cmd+N: an inline name field at the bottom of the list. Enter creates, Esc cancels. */
  showNewFileInput(): void {
    if (this.creating) {
      this.creating.input.focus();
      return;
    }
    const li = document.createElement("li");
    li.className = "sidebar__new";
    const input = document.createElement("input");
    input.className = "sidebar__new-input";
    input.type = "text";
    input.placeholder = "New file name";
    input.spellcheck = false;
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    const error = document.createElement("div");
    error.className = "sidebar__new-error";
    error.hidden = true;
    li.append(input, error);
    this.creating = { input, error };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        this.hideNewFileInput();
      } else if (e.key === "Enter") {
        e.preventDefault();
        void this.submitNewFile();
      }
    });
    input.addEventListener("blur", () => {
      // Clicking elsewhere with an empty field just cancels; a typed name stays until Enter/Esc.
      // A blur caused by our own re-render (the node being re-appended) is not a cancel.
      if (this.rendering) return;
      if (this.creating && input.value.trim() === "") this.hideNewFileInput();
    });

    this.render(this.files, this.activePath, this.missing, this.tocs, this.activeScope);
    input.focus();
  }

  hideNewFileInput(): void {
    if (!this.creating) return;
    this.creating = null;
    this.render(this.files, this.activePath, this.missing, this.tocs, this.activeScope);
  }

  get isCreating(): boolean {
    return this.creating !== null;
  }

  private async submitNewFile(): Promise<void> {
    if (!this.creating || !this.props.onCreate) return;
    const { input, error } = this.creating;
    const message = await this.props.onCreate(input.value);
    if (!this.creating) return;
    if (message) {
      error.textContent = message;
      error.hidden = false;
      input.focus();
    } else this.hideNewFileInput();
  }

  /** The list item under a reorder drag, or null for anything else (Finder drops, text). */
  private reorderTarget(e: DragEvent): HTMLElement | null {
    if (!Array.from(e.dataTransfer?.types ?? []).includes(REORDER_MIME)) return null;
    return (e.target as HTMLElement).closest<HTMLElement>("[data-path]");
  }

  private dropPosition(e: DragEvent, item: HTMLElement): "before" | "after" {
    const rect = item.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }

  private clearDropMarks(): void {
    for (const el of this.list.querySelectorAll(".is-drop-before, .is-drop-after"))
      el.classList.remove("is-drop-before", "is-drop-after");
  }

  /** Visual feedback while files are dragged over the window. */
  setDragOver(on: boolean): void {
    this.list.parentElement?.classList.toggle("is-dragover", on);
  }
}
