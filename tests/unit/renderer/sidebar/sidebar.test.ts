import { describe, expect, it, vi } from "vitest";
import { REORDER_MIME, reorder, Sidebar } from "../../../../src/renderer/sidebar/sidebar";
import type { Heading } from "../../../../src/shared/toc";

const heads = (...levels: Array<1 | 2>): Heading[] =>
  levels.map((level, i) => ({ level, text: `h${i}`, from: i * 10, to: i * 10 + 5 }));

const files = [
  { path: "/x/todo.md", anchor: 0, head: 0, scrollTop: 0 },
  { path: "/x/notes.txt", anchor: 0, head: 0, scrollTop: 0 },
  { path: "/x/config.json", anchor: 0, head: 0, scrollTop: 0 },
];

describe("Sidebar", () => {
  it("renders the empty hint when there are no files", () => {
    const list = document.createElement("ul");
    new Sidebar(list, { onSelect: vi.fn() }).render([], null, new Set());
    expect(list.querySelector(".sidebar__empty")?.textContent).toContain("Drop .md or .txt files here");
    expect(list.textContent).toContain("⌘N new file");
  });

  it("renders names without accepted extensions, marks active and missing", () => {
    const list = document.createElement("ul");
    new Sidebar(list, { onSelect: vi.fn() }).render(files, "/x/notes.txt", new Set(["/x/config.json"]));
    const items = [...list.querySelectorAll<HTMLElement>(".sidebar__item")];
    expect(items.map((i) => i.textContent)).toEqual(["todo", "notes", "config.json"]);
    expect(items.map((i) => i.title)).toEqual(files.map((f) => f.path));
    expect(items[1]!.classList.contains("is-active")).toBe(true);
    expect(items[0]!.classList.contains("is-active")).toBe(false);
    expect(items[2]!.classList.contains("is-missing")).toBe(true);
  });

  it("re-rendering replaces, never appends", () => {
    const list = document.createElement("ul");
    const sidebar = new Sidebar(list, { onSelect: vi.fn() });
    sidebar.render(files, null, new Set());
    sidebar.render(files.slice(0, 1), null, new Set());
    expect(list.children).toHaveLength(1);
  });

  it("clicking an item selects its path; clicking elsewhere does nothing", () => {
    const list = document.createElement("ul");
    const onSelect = vi.fn();
    const sidebar = new Sidebar(list, { onSelect });
    sidebar.render(files, null, new Set());
    list.querySelectorAll<HTMLElement>(".sidebar__item")[2]!.click();
    expect(onSelect).toHaveBeenCalledWith("/x/config.json");
    list.click();
    sidebar.render([], null, new Set());
    list.querySelector<HTMLElement>(".sidebar__empty")!.click();
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("right-click asks for the context menu and suppresses the browser one", () => {
    const list = document.createElement("ul");
    const onContextMenu = vi.fn();
    const sidebar = new Sidebar(list, { onSelect: vi.fn(), onContextMenu });
    sidebar.render(files, null, new Set());
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    list.querySelector<HTMLElement>(".sidebar__item")!.dispatchEvent(e);
    expect(onContextMenu).toHaveBeenCalledWith("/x/todo.md");
    expect(e.defaultPrevented).toBe(true);
    const outside = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    list.dispatchEvent(outside);
    expect(outside.defaultPrevented).toBe(false);
  });

  it("drag-over highlight toggles a class on the sidebar element", () => {
    const aside = document.createElement("aside");
    const list = document.createElement("ul");
    aside.append(list);
    const sidebar = new Sidebar(list, { onSelect: vi.fn() });
    sidebar.setDragOver(true);
    expect(aside.classList.contains("is-dragover")).toBe(true);
    sidebar.setDragOver(false);
    expect(aside.classList.contains("is-dragover")).toBe(false);
  });

  describe("outline (table of contents)", () => {
    it("shows a chevron only for files with an outline (>=2 of a level)", () => {
      const list = document.createElement("ul");
      const tocs = new Map<string, Heading[]>([
        ["/x/todo.md", heads(1, 2, 2)],
        ["/x/notes.txt", heads(1)], // not enough for a TOC
      ]);
      new Sidebar(list, { onSelect: vi.fn() }).render(files, null, new Set(), tocs);
      const items = [...list.querySelectorAll<HTMLElement>(".sidebar__item")];
      expect(items[0]!.querySelector(".sidebar__chevron")).not.toBeNull();
      expect(items[1]!.querySelector(".sidebar__chevron")).toBeNull();
      expect(items[2]!.querySelector(".sidebar__chevron")).toBeNull();
      expect(items[0]!.querySelector(".sidebar__name")?.textContent).toBe("todo");
    });

    it("clicking the chevron expands a flat list with H2s indented, and collapses again", () => {
      const list = document.createElement("ul");
      const tocs = new Map<string, Heading[]>([["/x/todo.md", heads(1, 2, 1)]]);
      const onSelect = vi.fn();
      const sidebar = new Sidebar(list, { onSelect });
      sidebar.render(files, null, new Set(), tocs);
      expect(list.querySelector(".sidebar__toc")).toBeNull();
      const chevron = list.querySelector<HTMLElement>(".sidebar__chevron")!;
      chevron.click();
      const tocItems = [...list.querySelectorAll<HTMLElement>(".sidebar__toc-item")];
      expect(tocItems.map((i) => i.textContent)).toEqual(["h0", "h1", "h2"]);
      expect(tocItems[1]!.classList.contains("is-h2")).toBe(true);
      expect(tocItems[0]!.classList.contains("is-h1")).toBe(true);
      expect(onSelect).not.toHaveBeenCalled(); // the chevron does not select the file
      list.querySelector<HTMLElement>(".sidebar__chevron")!.click();
      expect(list.querySelector(".sidebar__toc")).toBeNull();
    });

    it("clicking an outline item reports the path and heading index; the name still selects the file", () => {
      const list = document.createElement("ul");
      const tocs = new Map<string, Heading[]>([["/x/todo.md", heads(1, 2, 2)]]);
      const onSelect = vi.fn();
      const onSelectHeading = vi.fn();
      const sidebar = new Sidebar(list, { onSelect, onSelectHeading });
      sidebar.render(files, null, new Set(), tocs);
      list.querySelector<HTMLElement>(".sidebar__chevron")!.click();
      list.querySelectorAll<HTMLElement>(".sidebar__toc-item")[1]!.click();
      expect(onSelectHeading).toHaveBeenCalledWith("/x/todo.md", 1);
      expect(onSelect).not.toHaveBeenCalled();
      list.querySelector<HTMLElement>(".sidebar__name")!.click();
      expect(onSelect).toHaveBeenCalledWith("/x/todo.md");
    });

    it("marks the outline item whose range matches the active file's scope", () => {
      const list = document.createElement("ul");
      const toc = heads(1, 2, 2); // item 1 is { from: 10, to: 15 }
      const tocs = new Map<string, Heading[]>([["/x/todo.md", toc]]);
      const sidebar = new Sidebar(list, { onSelect: vi.fn() });
      sidebar.render(files, "/x/todo.md", new Set(), tocs, { from: 10, to: 15 });
      list.querySelector<HTMLElement>(".sidebar__chevron")!.click();
      const tocItems = [...list.querySelectorAll<HTMLElement>(".sidebar__toc-item")];
      expect(tocItems[0]!.classList.contains("is-current")).toBe(false);
      expect(tocItems[1]!.classList.contains("is-current")).toBe(true);
    });

    it("an empty heading renders a placeholder label", () => {
      const list = document.createElement("ul");
      const tocs = new Map<string, Heading[]>([
        [
          "/x/todo.md",
          [
            { level: 1, text: "", from: 0, to: 2 },
            { level: 1, text: "b", from: 2, to: 4 },
          ],
        ],
      ]);
      const sidebar = new Sidebar(list, { onSelect: vi.fn() });
      sidebar.render(files, null, new Set(), tocs);
      list.querySelector<HTMLElement>(".sidebar__chevron")!.click();
      expect(list.querySelector(".sidebar__toc-item")?.textContent).toBe("(untitled)");
    });
  });

  describe("new-file input", () => {
    const key = (input: HTMLInputElement, k: string) =>
      input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

    it("appears at the bottom, replaces the empty hint, creates on Enter, hides on success", async () => {
      const list = document.createElement("ul");
      document.body.append(list);
      const onCreate = vi.fn(async () => null);
      const sidebar = new Sidebar(list, { onSelect: vi.fn(), onCreate });
      sidebar.render([], null, new Set());
      sidebar.showNewFileInput();
      expect(list.querySelector(".sidebar__empty")).toBeNull();
      const input = list.querySelector<HTMLInputElement>(".sidebar__new-input")!;
      expect(document.activeElement).toBe(input);
      expect(input.spellcheck).toBe(false);
      input.value = "notes";
      key(input, "Enter");
      expect(onCreate).toHaveBeenCalledWith("notes");
      await vi.waitFor(() => expect(sidebar.isCreating).toBe(false));
      expect(list.querySelector(".sidebar__empty")).not.toBeNull();
      list.remove();
    });

    it("shows the error inline and keeps the field; Esc cancels; a second Cmd+N refocuses", async () => {
      const list = document.createElement("ul");
      document.body.append(list);
      const onCreate = vi.fn(async () => "notes.md already exists");
      const sidebar = new Sidebar(list, { onSelect: vi.fn(), onCreate });
      sidebar.render(files, "/x/todo.md", new Set());
      sidebar.showNewFileInput();
      const input = list.querySelector<HTMLInputElement>(".sidebar__new-input")!;
      expect(list.lastElementChild?.className).toBe("sidebar__new");
      expect(list.querySelectorAll(".sidebar__item")).toHaveLength(3);
      input.value = "notes";
      key(input, "Enter");
      await vi.waitFor(() =>
        expect(list.querySelector<HTMLElement>(".sidebar__new-error")!.hidden).toBe(false),
      );
      expect(list.querySelector(".sidebar__new-error")!.textContent).toBe("notes.md already exists");
      expect(sidebar.isCreating).toBe(true);
      sidebar.showNewFileInput();
      expect(list.querySelectorAll(".sidebar__new")).toHaveLength(1);
      key(input, "Escape");
      expect(sidebar.isCreating).toBe(false);
      expect(list.querySelector(".sidebar__new")).toBeNull();
      sidebar.hideNewFileInput(); // idempotent
      list.remove();
    });

    it("blur with an empty field cancels, with text it stays; Enter without onCreate is inert", async () => {
      const list = document.createElement("ul");
      document.body.append(list);
      const sidebar = new Sidebar(list, { onSelect: vi.fn() });
      sidebar.render(files, null, new Set());
      sidebar.showNewFileInput();
      let input = list.querySelector<HTMLInputElement>(".sidebar__new-input")!;
      key(input, "Enter");
      expect(sidebar.isCreating).toBe(true);
      input.value = "draft";
      input.dispatchEvent(new Event("blur"));
      expect(sidebar.isCreating).toBe(true);
      input.value = "";
      input.dispatchEvent(new Event("blur"));
      expect(sidebar.isCreating).toBe(false);
      sidebar.showNewFileInput();
      input = list.querySelector<HTMLInputElement>(".sidebar__new-input")!;
      key(input, "a"); // other keys pass through
      expect(sidebar.isCreating).toBe(true);
      list.remove();
    });

    it("a re-render while the input is focused keeps focus and does not cancel", () => {
      const list = document.createElement("ul");
      document.body.append(list);
      const sidebar = new Sidebar(list, { onSelect: vi.fn(), onCreate: vi.fn(async () => null) });
      sidebar.render(files, null, new Set());
      sidebar.showNewFileInput();
      const input = list.querySelector<HTMLInputElement>(".sidebar__new-input")!;
      expect(document.activeElement).toBe(input);
      sidebar.render(files.slice(0, 1), "/x/todo.md", new Set()); // e.g. openFile's trailing render
      expect(sidebar.isCreating).toBe(true);
      expect(list.querySelector(".sidebar__new-input")).toBe(input);
      expect(document.activeElement).toBe(input);
      expect(list.querySelectorAll(".sidebar__item")).toHaveLength(1);
      list.remove();
    });

    it("a create that resolves after cancel does nothing", async () => {
      const list = document.createElement("ul");
      document.body.append(list);
      let resolve!: (v: string | null) => void;
      const onCreate = vi.fn(() => new Promise<string | null>((r) => (resolve = r)));
      const sidebar = new Sidebar(list, { onSelect: vi.fn(), onCreate });
      sidebar.render(files, null, new Set());
      sidebar.showNewFileInput();
      const input = list.querySelector<HTMLInputElement>(".sidebar__new-input")!;
      input.value = "x";
      key(input, "Enter");
      key(input, "Escape");
      resolve("too late");
      await new Promise((r) => setTimeout(r, 0));
      expect(sidebar.isCreating).toBe(false);
      list.remove();
    });
  });

  describe("reorder()", () => {
    const list = [{ path: "a" }, { path: "b" }, { path: "c" }];
    it("moves before/after a target", () => {
      expect(reorder(list, "c", "a", "before").map((f) => f.path)).toEqual(["c", "a", "b"]);
      expect(reorder(list, "a", "c", "after").map((f) => f.path)).toEqual(["b", "c", "a"]);
      expect(reorder(list, "a", "b", "before").map((f) => f.path)).toEqual(["a", "b", "c"]);
    });
    it("leaves the list alone for self-drops and unknown paths", () => {
      expect(reorder(list, "a", "a", "after")).toEqual(list);
      expect(reorder(list, "zzz", "a", "after")).toEqual(list);
      expect(reorder(list, "a", "zzz", "after")).toEqual(list);
    });
  });

  describe("drag reorder", () => {
    function drag(type: string, target: EventTarget, types: string[], data = "", clientY = 0) {
      const e = new Event(type, { bubbles: true, cancelable: true }) as DragEvent & { clientY: number };
      Object.defineProperty(e, "clientY", { value: clientY });
      const store = new Map<string, string>();
      if (data) store.set(REORDER_MIME, data);
      Object.defineProperty(e, "dataTransfer", {
        value: {
          types,
          dropEffect: "none",
          effectAllowed: "none",
          setData: (k: string, v: string) => store.set(k, v),
          getData: (k: string) => store.get(k) ?? "",
        },
      });
      target.dispatchEvent(e);
      return e as DragEvent;
    }

    it("dragstart tags the item, dragover marks the drop side, drop reports the reorder", () => {
      const list = document.createElement("ul");
      const onReorder = vi.fn();
      const sidebar = new Sidebar(list, { onSelect: vi.fn(), onReorder });
      sidebar.render(files, null, new Set());
      const items = list.querySelectorAll<HTMLElement>(".sidebar__item");
      expect(items[0]!.draggable).toBe(true);
      items[1]!.getBoundingClientRect = () => ({ top: 100, height: 20 }) as DOMRect;

      const start = drag("dragstart", items[0]!, []);
      expect(start.dataTransfer!.getData(REORDER_MIME)).toBe("/x/todo.md");
      expect(items[0]!.classList.contains("is-dragging")).toBe(true);

      const over = drag("dragover", items[1]!, [REORDER_MIME], "/x/todo.md", 118);
      expect(over.defaultPrevented).toBe(true);
      expect(items[1]!.classList.contains("is-drop-after")).toBe(true);
      drag("dragover", items[1]!, [REORDER_MIME], "/x/todo.md", 102);
      expect(items[1]!.classList.contains("is-drop-before")).toBe(true);
      expect(items[1]!.classList.contains("is-drop-after")).toBe(false);

      const drop = drag("drop", items[1]!, [REORDER_MIME], "/x/todo.md", 118);
      expect(drop.defaultPrevented).toBe(true);
      expect(onReorder).toHaveBeenCalledWith("/x/todo.md", "/x/notes.txt", "after");
      expect(list.querySelector(".is-drop-after")).toBeNull();

      drag("dragend", items[0]!, []);
      expect(items[0]!.classList.contains("is-dragging")).toBe(false);
    });

    it("ignores Finder drops, drops onto itself, and drags outside items", () => {
      const list = document.createElement("ul");
      const onReorder = vi.fn();
      const sidebar = new Sidebar(list, { onSelect: vi.fn(), onReorder });
      sidebar.render(files, null, new Set());
      const items = list.querySelectorAll<HTMLElement>(".sidebar__item");
      const fileOver = drag("dragover", items[0]!, ["Files"]);
      expect(fileOver.defaultPrevented).toBe(false); // left to the window dropzone
      drag("drop", items[0]!, ["Files"]);
      drag("drop", items[0]!, [REORDER_MIME], "/x/todo.md");
      drag("drop", list, [REORDER_MIME], "/x/todo.md");
      drag("dragleave", list, [REORDER_MIME]);
      expect(onReorder).not.toHaveBeenCalled();
      const noData = drag("dragstart", list, []);
      expect(noData.dataTransfer!.getData(REORDER_MIME)).toBe("");
    });
  });
});
