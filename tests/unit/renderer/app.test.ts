import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyViewState,
  boot,
  CONFLICT_MESSAGE,
  MISSING_MESSAGE,
  READ_ONLY_MESSAGE,
  UNDO_REMOVE_MS,
  mount,
  type App,
} from "../../../src/renderer/app";
import type { Api, FilesOpened, MenuAction, WatchChanged, WatchMissing } from "../../../src/shared/ipc";
import { BUILTIN_THEMES, MEADOW, type Appearance, type Theme } from "../../../src/shared/themes";
import { defaultState, type AppState } from "../../../src/shared/state";
import { WELCOME_PAGE, WHATS_NEW_PAGE } from "../../../src/renderer/pages/pages";

function fakeApi(state: AppState, contents: Record<string, string>) {
  let opened: ((p: FilesOpened) => void) | null = null;
  let flushRequest: (() => void) | null = null;
  let watchChanged: ((p: WatchChanged) => void) | null = null;
  let watchMissing: ((p: WatchMissing) => void) | null = null;
  let menuAction: ((a: MenuAction) => void) | null = null;
  let themesChanged: ((t: Theme[]) => void) | null = null;
  let appearanceChanged: ((a: Appearance) => void) | null = null;
  const disk = { ...contents };
  const writes: { path: string; text: string; force: boolean }[] = [];
  let conflictNext = false;
  let formatFails = false;
  let mtime = 0;
  const api = {
    getState: vi.fn(async () => state),
    patchState: vi.fn(async (patch) => (state = { ...state, ...patch })),
    readFile: vi.fn(async (path: string) => {
      const text = disk[path];
      if (text === undefined) throw new Error("ENOENT");
      return {
        text,
        eol: "\n",
        bom: false,
        stamp: { mtimeMs: ++mtime, size: text.length },
        large: path.endsWith("big.md"),
        readOnly: path.endsWith("bad.txt") || path.endsWith("ro.json"),
      };
    }),
    formatText: vi.fn(async (req: { path: string; text: string }) =>
      formatFails
        ? { ok: false as const, error: "boom" }
        : { ok: true as const, text: `${req.text} [formatted]` },
    ),
    writeFile: vi.fn(async (req: { path: string; text: string; force?: boolean }) => {
      writes.push({ path: req.path, text: req.text, force: req.force === true });
      if (conflictNext && !req.force) {
        conflictNext = false;
        return { ok: false as const, conflict: { mtimeMs: 9, size: 9 } };
      }
      disk[req.path] = req.text;
      return { ok: true as const, stamp: { mtimeMs: 2, size: req.text.length } };
    }),
    flushed: vi.fn(async (_pending: string[]) => undefined),
    onFilesOpened: vi.fn((cb: (p: FilesOpened) => void) => {
      opened = cb;
      return () => (opened = null);
    }),
    onFlushRequest: vi.fn((cb: () => void) => {
      flushRequest = cb;
      return () => (flushRequest = null);
    }),
    onWatchChanged: vi.fn((cb: (p: WatchChanged) => void) => {
      watchChanged = cb;
      return () => (watchChanged = null);
    }),
    onWatchMissing: vi.fn((cb: (p: WatchMissing) => void) => {
      watchMissing = cb;
      return () => (watchMissing = null);
    }),
    onMenuAction: vi.fn((cb: (a: MenuAction) => void) => {
      menuAction = cb;
      return () => (menuAction = null);
    }),
    removeFile: vi.fn(async (path: string) => {
      state = {
        ...state,
        files: state.files.filter((f) => f.path !== path),
        activePath: state.activePath === path ? null : state.activePath,
      };
      return state;
    }),
    createFile: vi.fn(async (dir: string | null, name: string) =>
      name === "dup"
        ? { ok: false as const, error: "dup.md already exists" }
        : { ok: true as const, path: `${dir ?? "/Documents"}/${name}.md` },
    ),
    showFileMenu: vi.fn(async () => undefined),
    addFiles: vi.fn(async (paths: string[]) => {
      const fresh = paths.filter((p) => !state.files.some((f) => f.path === p));
      state = {
        ...state,
        files: [...state.files, ...fresh.map((path) => ({ path, anchor: 0, head: 0, scrollTop: 0 }))],
      };
      return { added: paths, rejected: [] };
    }),
    pathForFile: vi.fn((f: File) => `/dropped/${f.name}`),
    listThemes: vi.fn(async () => ({ themes: [...BUILTIN_THEMES], appearance: "light" as const })),
    onThemesChanged: vi.fn((cb: (t: Theme[]) => void) => {
      themesChanged = cb;
      return () => (themesChanged = null);
    }),
    onAppearanceChanged: vi.fn((cb: (a: Appearance) => void) => {
      appearanceChanged = cb;
      return () => (appearanceChanged = null);
    }),
  } as unknown as Api;
  return {
    api,
    disk,
    writes,
    conflictOnce: () => (conflictNext = true),
    failFormat: () => (formatFails = true),
    fire: (p: FilesOpened) => opened?.(p),
    requestFlush: () => flushRequest?.(),
    changed: (path: string) => watchChanged?.({ path, stamp: { mtimeMs: 5, size: 5 } }),
    gone: (path: string) => watchMissing?.({ path }),
    menu: (a: MenuAction) => menuAction?.(a),
    themes: (t: Theme[]) => themesChanged?.(t),
    appearance: (a: Appearance) => appearanceChanged?.(a),
    state: () => state,
  };
}

const apps: App[] = [];
afterEach(() => {
  for (const a of apps.splice(0)) a.dispose();
});

describe("mount", () => {
  it("renders sidebar, notice host and editor host", () => {
    const root = document.createElement("div");
    const shell = mount(root);
    expect(root.querySelector("aside.sidebar ul.sidebar__list")).toBe(shell.list);
    expect(root.querySelector("main.editor .editor__notice")).toBe(shell.noticeHost);
    expect(root.querySelector("main.editor .editor__host")).toBe(shell.editorHost);
    expect(root.querySelector(".sidebar .sidebar__divider")).toBe(shell.divider);
    expect(root.querySelector(".settings")).toBe(shell.settingsHost);
    mount(root);
    expect(root.children).toHaveLength(3);
  });
});

describe("applyViewState", () => {
  it("sets sidebar width/visibility and font size variables and the highlight-off class", () => {
    const html = document.createElement("html");
    applyViewState(html, { sidebarWidth: 240, sidebarVisible: true, fontSize: 16, highlight: true });
    expect(html.style.getPropertyValue("--te-sidebar-width")).toBe("240px");
    expect(html.style.getPropertyValue("--te-font-size")).toBe("16px");
    expect(html.classList.contains("highlight-off")).toBe(false);
    applyViewState(html, { sidebarWidth: 240, sidebarVisible: false, fontSize: 14, highlight: false });
    expect(html.style.getPropertyValue("--te-sidebar-width")).toBe("0px");
    expect(html.classList.contains("sidebar-hidden")).toBe(true);
    expect(html.classList.contains("highlight-off")).toBe(true);
    applyViewState(html, { sidebarWidth: 240, sidebarVisible: true, fontSize: 14, highlight: true });
    expect(html.classList.contains("highlight-off")).toBe(false);
  });
});

describe("boot", () => {
  const twoFiles = (): AppState => ({
    ...defaultState(),
    files: [
      { path: "/a.md", anchor: 2, head: 2, scrollTop: 0 },
      { path: "/b.md", anchor: 0, head: 0, scrollTop: 0 },
    ],
    activePath: "/a.md",
  });

  it("opens the active file with its saved caret and renders the sidebar", async () => {
    const { api } = fakeApi(twoFiles(), { "/a.md": "hello a", "/b.md": "hello b" });
    const root = document.createElement("div");
    const app = await boot(root, api);
    apps.push(app);
    expect(app.editor.currentPath).toBe("/a.md");
    expect(app.editor.view.state.doc.toString()).toBe("hello a");
    expect(app.editor.view.state.selection.main.head).toBe(2);
    expect([...root.querySelectorAll(".sidebar__item")].map((i) => i.textContent)).toEqual(["a", "b"]);
    expect(root.querySelector(".is-active")?.textContent).toBe("a");
    expect(app.notice.visible).toBe(false);
  });

  it("switches files from the sidebar and persists the active path", async () => {
    const { api, state } = fakeApi(twoFiles(), { "/a.md": "hello a", "/b.md": "hello b" });
    const app = await boot(document.createElement("div"), api);
    apps.push(app);
    app.shell.list.querySelectorAll<HTMLElement>(".sidebar__item")[1]!.click();
    await vi.waitFor(() => expect(app.editor.currentPath).toBe("/b.md"));
    expect(app.editor.view.state.doc.toString()).toBe("hello b");
    expect(state().activePath).toBe("/b.md");
    expect(app.shell.list.querySelector(".is-active")?.textContent).toBe("b");
  });

  it("shows the missing-file notice and dims the entry when a read fails", async () => {
    const { api } = fakeApi(twoFiles(), { "/b.md": "b" });
    const app = await boot(document.createElement("div"), api);
    apps.push(app);
    expect(app.notice.visible).toBe(true);
    expect(app.notice.message).toBe(MISSING_MESSAGE);
    expect(app.missing.has("/a.md")).toBe(true);
    expect(app.shell.list.querySelector(".is-missing")?.textContent).toBe("a");
    expect(app.editor.view.state.doc.toString()).toBe("");
    await app.openFile("/b.md");
    expect(app.notice.visible).toBe(false);
  });

  it("warns on large files and ignores unknown paths", async () => {
    const state = {
      ...twoFiles(),
      files: [{ path: "/big.md", anchor: 0, head: 0, scrollTop: 0 }],
      activePath: "/big.md",
    };
    const { api } = fakeApi(state, { "/big.md": "x" });
    const app = await boot(document.createElement("div"), api);
    apps.push(app);
    expect(app.notice.message).toContain("Large file");
    await app.openFile("/not-listed.md");
    expect(app.editor.currentPath).toBe("/big.md");
  });

  it("starts empty with the hint when there are no files", async () => {
    const { api } = fakeApi(defaultState(), {});
    const root = document.createElement("div");
    const app = await boot(root, api);
    apps.push(app);
    expect(root.querySelector(".sidebar__empty")).not.toBeNull();
    expect(app.editor.currentPath).toBeNull();
  });

  it("refreshes from main and opens the first file when files:opened arrives", async () => {
    const f = fakeApi(defaultState(), { "/new.md": "fresh" });
    const app = await boot(document.createElement("div"), f.api);
    apps.push(app);
    (f.api.getState as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...defaultState(),
      files: [{ path: "/new.md", anchor: 0, head: 0, scrollTop: 0 }],
    });
    f.fire({ paths: ["/new.md"] });
    await vi.waitFor(() => expect(app.editor.currentPath).toBe("/new.md"));
    expect(app.editor.view.state.doc.toString()).toBe("fresh");
    f.fire({ paths: ["/unknown.md"] });
    await vi.waitFor(() => expect(f.api.getState).toHaveBeenCalledTimes(3));
    expect(app.editor.currentPath).toBe("/new.md");
  });

  it("dispose unsubscribes", async () => {
    const f = fakeApi(defaultState(), {});
    const app = await boot(document.createElement("div"), f.api);
    app.dispose();
    expect(f.api.onFilesOpened).toHaveBeenCalledTimes(1);
    f.fire({ paths: ["/x.md"] });
    expect(f.api.getState).toHaveBeenCalledTimes(1);
  });

  it("autosaves edits after the idle period and flushes when switching files", async () => {
    vi.useFakeTimers();
    const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
    const app = await boot(document.createElement("div"), f.api);
    apps.push(app);
    app.editor.view.dispatch({ changes: { from: 3, insert: "!" } });
    await vi.advanceTimersByTimeAsync(299);
    expect(f.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.writes).toEqual([{ path: "/a.md", text: "aaa!", force: false }]);
    app.editor.view.dispatch({ changes: { from: 4, insert: "?" } });
    const switching = app.openFile("/b.md");
    await vi.runAllTimersAsync();
    await switching;
    expect(f.disk["/a.md"]).toBe("aaa!?");
    vi.useRealTimers();
  });

  it("flushes on window blur, on hidden visibility, and on main's flush request (then acks)", async () => {
    const win = new EventTarget() as unknown as Window;
    const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
    const app = await boot(document.createElement("div"), f.api, { win, doc: document });
    apps.push(app);
    app.editor.view.dispatch({ changes: { from: 0, insert: "1" } });
    win.dispatchEvent(new Event("blur"));
    await vi.waitFor(() => expect(f.disk["/a.md"]).toBe("1aaa"));

    app.editor.view.dispatch({ changes: { from: 0, insert: "2" } });
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(f.disk["/a.md"]).toBe("21aaa"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    app.editor.view.dispatch({ changes: { from: 0, insert: "3" } });
    f.requestFlush();
    await vi.waitFor(() => expect(f.api.flushed).toHaveBeenCalledTimes(1));
    expect(f.disk["/a.md"]).toBe("321aaa");
  });

  it("shows the conflict bar; Keep mine forces the write, Reload takes the disk version", async () => {
    const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
    const app = await boot(document.createElement("div"), f.api);
    apps.push(app);

    f.conflictOnce();
    app.editor.view.dispatch({ changes: { from: 3, insert: "!" } });
    await app.autosave.flush();
    expect(app.notice.message).toBe(CONFLICT_MESSAGE);
    const buttons = [...app.shell.noticeHost.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Reload", "Keep mine"]);
    buttons[1]!.click();
    await vi.waitFor(() => expect(f.disk["/a.md"]).toBe("aaa!"));
    await vi.waitFor(() => expect(app.notice.visible).toBe(false));
    expect(f.writes.at(-1)).toMatchObject({ force: true });

    f.conflictOnce();
    f.disk["/a.md"] = "from elsewhere";
    app.editor.view.dispatch({ changes: { from: 0, insert: "x" } });
    await app.autosave.flush();
    expect(app.notice.message).toBe(CONFLICT_MESSAGE);
    app.shell.noticeHost.querySelector("button")!.click();
    await vi.waitFor(() => expect(app.editor.view.state.doc.toString()).toBe("from elsewhere"));
    expect(app.notice.visible).toBe(false);
  });

  it("a conflict on a background file does not surface a bar", async () => {
    const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
    const app = await boot(document.createElement("div"), f.api);
    apps.push(app);
    await app.openFile("/b.md");
    f.conflictOnce();
    app.autosave.markDirty("/a.md");
    await app.autosave.flush("/a.md");
    expect(app.autosave.isParked("/a.md")).toBe(true);
    expect(app.notice.visible).toBe(false);
  });

  it("recreating a missing file clears the notice and un-dims the entry", async () => {
    const f = fakeApi(twoFiles(), { "/b.md": "b" });
    const app = await boot(document.createElement("div"), f.api);
    apps.push(app);
    expect(app.notice.message).toBe(MISSING_MESSAGE);
    app.editor.view.dispatch({ changes: { from: 0, insert: "reborn" } });
    await app.autosave.flush();
    expect(f.writes[0]).toMatchObject({ path: "/a.md", text: "reborn" });
    expect(app.missing.has("/a.md")).toBe(false);
    expect(app.notice.visible).toBe(false);
    expect(app.shell.list.querySelector(".is-missing")).toBeNull();
  });

  it("a failed save shows a Retry notice that retries", async () => {
    const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
    const app = await boot(document.createElement("div"), f.api);
    apps.push(app);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    (f.api.writeFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("EACCES"));
    app.editor.view.dispatch({ changes: { from: 0, insert: "x" } });
    await app.autosave.flush();
    expect(app.notice.message).toBe("Couldn't save a");
    expect(app.saveErrors.has("/a.md")).toBe(true);
    app.shell.noticeHost.querySelector("button")!.click();
    await vi.waitFor(() => expect(f.disk["/a.md"]).toBe("xaaa"));
    expect(app.saveErrors.has("/a.md")).toBe(false);
    expect(app.notice.visible).toBe(false);
    spy.mockRestore();
  });

  it("a save that fails while switching away stays visible when the file is active again, and is reported at quit", async () => {
    const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
    const app = await boot(document.createElement("div"), f.api);
    apps.push(app);
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    (f.api.writeFile as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("EACCES"));
    app.editor.view.dispatch({ changes: { from: 0, insert: "x" } });
    await app.openFile("/b.md"); // the flush on switch fails
    expect(app.notice.visible).toBe(false); // b is fine
    expect(app.saveErrors.has("/a.md")).toBe(true);
    await app.openFile("/a.md");
    expect(app.notice.message).toBe("Couldn't save a"); // not hidden by the switch
    f.requestFlush(); // quit: the renderer tells main what is still unsaved
    await vi.waitFor(() => expect(f.api.flushed).toHaveBeenCalledWith(["/a.md"]));
    spy.mockRestore();
  });

  it("a parked conflict is reported as pending when main asks to flush for quit", async () => {
    const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
    const app = await boot(document.createElement("div"), f.api);
    apps.push(app);
    f.conflictOnce();
    app.editor.view.dispatch({ changes: { from: 3, insert: "!" } });
    await app.autosave.flush();
    expect(app.notice.message).toBe(CONFLICT_MESSAGE);
    f.requestFlush();
    await vi.waitFor(() => expect(f.api.flushed).toHaveBeenCalledWith(["/a.md"]));
    expect(f.writes).toHaveLength(1); // nothing was forced
  });

  it("a file that is not valid UTF-8 opens read-only with a notice; nothing is ever written", async () => {
    const state = {
      ...defaultState(),
      files: [
        { path: "/bad.txt", anchor: 0, head: 0, scrollTop: 0 },
        { path: "/a.md", anchor: 0, head: 0, scrollTop: 0 },
      ],
      activePath: "/bad.txt",
    };
    const f = fakeApi(state, { "/bad.txt": "caf\uFFFD", "/a.md": "aaa" });
    const app = await boot(document.createElement("div"), f.api);
    apps.push(app);
    expect(app.notice.message).toBe(READ_ONLY_MESSAGE);
    expect(app.readOnly.has("/bad.txt")).toBe(true);
    expect(app.editor.view.state.readOnly).toBe(true);
    await app.openFile("/a.md");
    expect(app.notice.visible).toBe(false);
    expect(app.editor.view.state.readOnly).toBe(false);
    await app.openFile("/bad.txt");
    expect(app.notice.message).toBe(READ_ONLY_MESSAGE);
    f.requestFlush();
    await vi.waitFor(() => expect(f.api.flushed).toHaveBeenCalledWith([]));
    expect(f.writes).toHaveLength(0);
  });

  it("reopening an already-open file keeps its buffer and re-shows the missing notice if needed", async () => {
    const f = fakeApi(twoFiles(), { "/b.md": "b" });
    const app = await boot(document.createElement("div"), f.api);
    apps.push(app);
    await app.openFile("/b.md");
    await app.openFile("/a.md");
    expect(app.notice.message).toBe(MISSING_MESSAGE);
    expect(f.api.readFile).toHaveBeenCalledTimes(2);
  });

  it("reloadFile on a background or missing file behaves", async () => {
    const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
    const app = await boot(document.createElement("div"), f.api);
    apps.push(app);
    f.disk["/b.md"] = "new b";
    await app.reloadFile("/b.md");
    await app.openFile("/b.md");
    expect(app.editor.view.state.doc.toString()).toBe("new b");
    delete f.disk["/b.md"];
    await app.reloadFile("/b.md");
    expect(app.notice.message).toBe(MISSING_MESSAGE);
  });

  describe("watch events", () => {
    it("reloads a clean active file silently, keeping the caret clamped", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      f.disk["/a.md"] = "a";
      f.changed("/a.md");
      await vi.waitFor(() => expect(app.editor.view.state.doc.toString()).toBe("a"));
      expect(app.editor.view.state.selection.main.head).toBe(1);
      expect(app.notice.visible).toBe(false);
    });

    it("reloads a clean background file so switching shows the new text without a read", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      await app.openFile("/b.md");
      f.disk["/a.md"] = "new a";
      f.changed("/a.md");
      await vi.waitFor(() => expect(app.editor.text("/a.md")).toBe("new a"));
      const reads = (f.api.readFile as ReturnType<typeof vi.fn>).mock.calls.length;
      await app.openFile("/a.md");
      expect(app.editor.view.state.doc.toString()).toBe("new a");
      expect((f.api.readFile as ReturnType<typeof vi.fn>).mock.calls.length).toBe(reads);
    });

    it("a change under unsaved edits parks the file and shows the bar; Reload takes the disk text", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      app.editor.view.dispatch({ changes: { from: 3, insert: "!" } });
      f.disk["/a.md"] = "theirs";
      f.changed("/a.md");
      await vi.waitFor(() => expect(app.notice.message).toBe(CONFLICT_MESSAGE));
      expect(app.autosave.isParked("/a.md")).toBe(true);
      await app.autosave.flush();
      expect(f.writes).toHaveLength(0);
      app.shell.noticeHost.querySelector("button")!.click();
      await vi.waitFor(() => expect(app.editor.view.state.doc.toString()).toBe("theirs"));
      expect(app.conflicts.has("/a.md")).toBe(false);
      expect(app.autosave.isDirty("/a.md")).toBe(false);
    });

    it("a conflict on a dirty background file waits until that file is active", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      app.editor.view.dispatch({ changes: { from: 0, insert: "x" } });
      (f.api.writeFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        conflict: { mtimeMs: 1, size: 1 },
      });
      await app.openFile("/b.md"); // the flush on switch conflicts → parked, no bar (b is active)
      expect(app.conflicts.has("/a.md")).toBe(true);
      expect(app.notice.visible).toBe(false);
      await app.openFile("/a.md");
      expect(app.notice.message).toBe(CONFLICT_MESSAGE);
      [...app.shell.noticeHost.querySelectorAll("button")][1]!.click(); // Keep mine
      await vi.waitFor(() => expect(f.disk["/a.md"]).toBe("xaaa"));
      await vi.waitFor(() => expect(app.notice.visible).toBe(false));
    });

    it("ignores changes for unlisted or not-yet-loaded files", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      const reads = (f.api.readFile as ReturnType<typeof vi.fn>).mock.calls.length;
      f.changed("/b.md");
      f.changed("/zzz.md");
      f.gone("/zzz.md");
      await new Promise((r) => setTimeout(r, 10));
      expect((f.api.readFile as ReturnType<typeof vi.fn>).mock.calls.length).toBe(reads);
      expect(app.missing.size).toBe(0);
    });

    it("a missing push dims the entry, shows the notice when active, and later saves recreate it", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      f.gone("/b.md");
      expect(app.shell.list.querySelector(".is-missing")?.textContent).toBe("b");
      expect(app.notice.visible).toBe(false);
      f.gone("/a.md");
      expect(app.notice.message).toBe(MISSING_MESSAGE);
      expect(app.meta.get("/a.md")?.stamp).toBeNull();
      app.editor.view.dispatch({ changes: { from: 0, insert: "r" } });
      await app.autosave.flush();
      expect(f.writes.at(-1)).toMatchObject({ path: "/a.md" });
      expect(app.missing.has("/a.md")).toBe(false);
      expect(app.notice.visible).toBe(false);
    });

    it("a missing push does not replace an open conflict bar", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      app.editor.view.dispatch({ changes: { from: 0, insert: "x" } });
      f.disk["/a.md"] = "theirs";
      f.changed("/a.md");
      await vi.waitFor(() => expect(app.notice.message).toBe(CONFLICT_MESSAGE));
      f.gone("/a.md");
      expect(app.notice.message).toBe(CONFLICT_MESSAGE);
    });

    it("a touched file whose bytes are unchanged is neither reloaded nor a conflict", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      app.editor.view.dispatch({ changes: { from: 3, insert: "!" } }); // dirty …
      f.changed("/a.md"); // … and the mtime moved (a sync tool rewrote the same bytes)
      await vi.waitFor(() => expect(f.api.readFile).toHaveBeenCalledTimes(2));
      await new Promise((r) => setTimeout(r, 5));
      expect(app.notice.visible).toBe(false);
      expect(app.autosave.isParked("/a.md")).toBe(false);
      expect(app.editor.view.state.doc.toString()).toBe("aaa!");
      expect(app.meta.get("/a.md")?.stamp?.mtimeMs).toBe(2); // the new stamp is adopted, so the next save passes the guard
      await app.autosave.flush();
      expect(f.disk["/a.md"]).toBe("aaa!");
    });

    it("a real change on a clean file keeps the undo history and reports nothing to autosave", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa\nbbb", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      app.editor.view.dispatch({ changes: { from: 7, insert: "!" } });
      await app.autosave.flush();
      f.disk["/a.md"] = "AAA\nbbb!";
      f.changed("/a.md");
      await vi.waitFor(() => expect(app.editor.view.state.doc.toString()).toBe("AAA\nbbb!"));
      await new Promise((r) => setTimeout(r, 400));
      expect(f.writes).toHaveLength(1); // the reload did not trigger a save
      expect(app.meta.get("/a.md")?.disk).toBe("AAA\nbbb!");
    });

    it("a change under a read that fails is left to the missing push", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      delete f.disk["/a.md"];
      f.changed("/a.md");
      await vi.waitFor(() => expect(f.api.readFile).toHaveBeenCalledTimes(2));
      await new Promise((r) => setTimeout(r, 5));
      expect(app.missing.has("/a.md")).toBe(false);
      expect(app.notice.visible).toBe(false);
    });
  });

  describe("table of contents", () => {
    const md = "# Alpha\nalpha body\n## A1\nnested\n# Beta\nbeta body";
    const docState = (): AppState => ({
      ...defaultState(),
      files: [{ path: "/doc.md", anchor: 0, head: 0, scrollTop: 0 }],
      activePath: "/doc.md",
    });

    it("builds an outline, scopes to a clicked section, and clears it when the name is clicked", async () => {
      const { api } = fakeApi(docState(), { "/doc.md": md });
      const app = await boot(document.createElement("div"), api);
      apps.push(app);
      expect(app.tocs.get("/doc.md")?.map((h) => h.text)).toEqual(["Alpha", "A1", "Beta"]);
      const chevron = app.shell.list.querySelector<HTMLElement>(".sidebar__chevron");
      expect(chevron).not.toBeNull();
      chevron!.click();
      expect([...app.shell.list.querySelectorAll(".sidebar__toc-item")].map((i) => i.textContent)).toEqual([
        "Alpha",
        "A1",
        "Beta",
      ]);

      app.shell.list.querySelectorAll<HTMLElement>(".sidebar__toc-item")[2]!.click(); // Beta
      await vi.waitFor(() => expect(app.editor.scopeOf("/doc.md")).not.toBeNull());
      const beta = app.tocs.get("/doc.md")![2]!;
      expect(app.editor.scopeOf("/doc.md")).toEqual({ from: beta.from, to: beta.to });
      expect(app.editor.view.state.doc.toString()).toBe(md); // whole file still in the buffer
      expect(app.shell.list.querySelector(".sidebar__toc-item.is-current")?.textContent).toBe("Beta");

      app.shell.list.querySelector<HTMLElement>(".sidebar__name")!.click(); // the filename → full file
      await vi.waitFor(() => expect(app.editor.scopeOf("/doc.md")).toBeNull());
      expect(app.shell.list.querySelector(".sidebar__toc-item.is-current")).toBeNull();
    });

    it("refreshes the outline after typing settles", async () => {
      vi.useFakeTimers();
      const { api } = fakeApi(docState(), { "/doc.md": "# One\n# Two" });
      const app = await boot(document.createElement("div"), api);
      apps.push(app);
      expect(app.tocs.get("/doc.md")?.map((h) => h.text)).toEqual(["One", "Two"]);
      app.editor.view.dispatch({ changes: { from: app.editor.view.state.doc.length, insert: "\n# Three" } });
      await vi.advanceTimersByTimeAsync(400); // outline (200 ms) and autosave (300 ms) both settle
      expect(app.tocs.get("/doc.md")?.map((h) => h.text)).toEqual(["One", "Two", "Three"]);
      vi.useRealTimers();
    });

    it("drops the outline when a file is removed from the list", async () => {
      const { api } = fakeApi(docState(), { "/doc.md": md });
      const app = await boot(document.createElement("div"), api);
      apps.push(app);
      expect(app.tocs.has("/doc.md")).toBe(true);
      await app.removeFile("/doc.md");
      expect(app.tocs.has("/doc.md")).toBe(false);
    });
  });

  describe("read-only pages", () => {
    it("shows the welcome page when no file is selected; it is read-only and never saved", async () => {
      const f = fakeApi(defaultState(), {});
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      expect(app.editor.currentPath).toBeNull();
      expect(app.editor.view.state.doc.toString()).toBe(WELCOME_PAGE);
      expect(app.editor.view.state.readOnly).toBe(true);
      expect(WELCOME_PAGE).toMatch(/^# Welcome to Tiny Edit/);
      expect(WELCOME_PAGE).toContain("saved");
      expect(f.api.writeFile).not.toHaveBeenCalled();
    });

    it("Help → What's New saves and deselects the active file, then shows the page; the file reopens intact", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      app.editor.view.dispatch({ changes: { from: 0, insert: "x" } });
      f.menu({ type: "showWhatsNew" });
      await vi.waitFor(() => expect(app.editor.currentPath).toBeNull());
      expect(f.disk["/a.md"]).toBe("xaaa");
      expect(app.editor.view.state.doc.toString()).toBe(WHATS_NEW_PAGE);
      expect(app.editor.view.state.readOnly).toBe(true);
      expect(app.store.get().activePath).toBeNull();
      expect(app.shell.list.querySelector(".is-active")).toBeNull();
      expect(WHATS_NEW_PAGE).toMatch(/^# What's New in Tiny Edit/);
      expect(WHATS_NEW_PAGE).toMatch(/^## \d+\.\d+\.\d+ — \d{4}-\d{2}-\d{2}$/m);
      await app.openFile("/a.md");
      expect(app.editor.view.state.doc.toString()).toBe("xaaa");
      expect(app.store.get().activePath).toBe("/a.md");
      // With nothing active the page still shows.
      await app.showPage("page");
      await app.showPage(WHATS_NEW_PAGE);
      expect(app.editor.view.state.doc.toString()).toBe(WHATS_NEW_PAGE);
    });
  });

  describe("menu actions and removal", () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));

    it("Pretty Format replaces the active buffer with the formatted text and autosaves it", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      f.menu({ type: "prettyFormat" });
      await vi.waitFor(() => expect(app.editor.view.state.doc.toString()).toBe("aaa [formatted]"));
      expect(f.api.formatText).toHaveBeenCalledWith({ path: "/a.md", text: "aaa" });
      await app.autosave.flush();
      expect(f.disk["/a.md"]).toBe("aaa [formatted]");
    });

    it("Pretty Format leaves the buffer untouched when main reports a problem", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      f.failFormat();
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      f.menu({ type: "prettyFormat" });
      await tick();
      expect(app.editor.view.state.doc.toString()).toBe("aaa");
      expect(f.writes).toHaveLength(0);
    });

    it("Pretty Format does nothing for a non-formattable, read-only, or absent file", async () => {
      const state: AppState = {
        ...defaultState(),
        files: [
          { path: "/note.txt", anchor: 0, head: 0, scrollTop: 0 },
          { path: "/ro.json", anchor: 0, head: 0, scrollTop: 0 },
        ],
        activePath: "/note.txt",
      };
      const f = fakeApi(state, { "/note.txt": "hi", "/ro.json": "{}" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      f.menu({ type: "prettyFormat" }); // .txt has no structured format
      await tick();
      await app.openFile("/ro.json");
      f.menu({ type: "prettyFormat" }); // formattable but opened read-only
      await tick();
      f.menu({ type: "showWhatsNew" }); // no active file at all
      await tick();
      f.menu({ type: "prettyFormat" });
      await tick();
      expect(f.api.formatText).not.toHaveBeenCalled();
    });

    it("Cmd+W / closeFile saves pending edits, removes the active file, and opens its neighbour", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      app.editor.view.dispatch({ changes: { from: 0, insert: "x" } });
      f.menu({ type: "closeFile" });
      await vi.waitFor(() => expect(app.editor.currentPath).toBe("/b.md"));
      expect(f.disk["/a.md"]).toBe("xaaa");
      expect(f.api.removeFile).toHaveBeenCalledWith("/a.md");
      expect(app.store.get().files.map((x) => x.path)).toEqual(["/b.md"]);
      expect(app.editor.isOpen("/a.md")).toBe(false);
      expect([...app.shell.list.querySelectorAll(".sidebar__item")].map((i) => i.textContent)).toEqual(["b"]);
      f.menu({ type: "closeFile" });
      await vi.waitFor(() => expect(app.editor.currentPath).toBeNull());
      expect(app.shell.list.querySelector(".sidebar__empty")).not.toBeNull();
      expect(app.editor.view.state.doc.toString()).toBe(WELCOME_PAGE); // last file closed → welcome page
      f.menu({ type: "closeFile" }); // nothing active: no-op
      await app.removeFile("/zzz.md");
    });

    it("removing a file offers Undo for a while, which puts it back where it was", async () => {
      vi.useFakeTimers();
      const three = (): AppState => ({
        ...defaultState(),
        files: [
          { path: "/a.md", anchor: 0, head: 0, scrollTop: 0 },
          { path: "/b.md", anchor: 0, head: 0, scrollTop: 0 },
          { path: "/c.md", anchor: 0, head: 0, scrollTop: 0 },
        ],
        activePath: "/b.md",
      });
      const f = fakeApi(three(), { "/a.md": "a", "/b.md": "b", "/c.md": "c" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      await app.removeFile("/b.md");
      expect(app.editor.currentPath).toBe("/c.md");
      expect(app.notice.message).toBe("Removed b from the sidebar");
      const undo = app.shell.noticeHost.querySelector("button")!;
      expect(undo.textContent).toBe("Undo");
      f.changed("/c.md"); // status refreshes do not steal the bar while Undo is offered
      await vi.advanceTimersByTimeAsync(10);
      expect(app.notice.message).toBe("Removed b from the sidebar");
      undo.click();
      await vi.waitFor(() =>
        expect(app.store.get().files.map((x) => x.path)).toEqual(["/a.md", "/b.md", "/c.md"]),
      );
      expect(f.api.addFiles).toHaveBeenCalledWith(["/b.md"]);
      expect(app.notice.visible).toBe(false);

      await app.removeFile("/c.md"); // last entry: Undo appends at the end
      expect(app.notice.message).toBe("Removed c from the sidebar");
      app.shell.noticeHost.querySelector("button")!.click();
      await vi.waitFor(() =>
        expect(app.store.get().files.map((x) => x.path)).toEqual(["/a.md", "/b.md", "/c.md"]),
      );

      await app.removeFile("/a.md"); // let the offer expire instead
      await vi.advanceTimersByTimeAsync(UNDO_REMOVE_MS);
      expect(app.notice.visible).toBe(false);
      expect(app.store.get().files.map((x) => x.path)).toEqual(["/b.md", "/c.md"]);

      (f.api.addFiles as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        added: [],
        rejected: [{ path: "/b.md", reason: "missing" }],
      });
      await app.removeFile("/b.md");
      app.shell.noticeHost.querySelector("button")!.click(); // the file vanished meanwhile: nothing to restore
      await vi.advanceTimersByTimeAsync(10);
      expect(app.store.get().files.map((x) => x.path)).toEqual(["/c.md"]);
      vi.useRealTimers();
    });

    it("context-menu removeFile on a background file keeps the active one; previous neighbour used at the end", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      await app.openFile("/b.md");
      f.menu({ type: "removeFile", path: "/a.md" });
      await vi.waitFor(() => expect(app.store.get().files).toHaveLength(1));
      expect(app.editor.currentPath).toBe("/b.md");
    });

    it("removing the last file falls back to the previous neighbour", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      await app.openFile("/b.md");
      await app.removeFile("/b.md");
      expect(app.editor.currentPath).toBe("/a.md");
    });

    it("newFile shows the inline input; creating uses the active file's folder, errors come back inline", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      f.menu({ type: "newFile" });
      const input = app.shell.list.querySelector<HTMLInputElement>(".sidebar__new-input")!;
      input.value = "dup";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await vi.waitFor(() =>
        expect(app.shell.list.querySelector(".sidebar__new-error")?.textContent).toBe(
          "dup.md already exists",
        ),
      );
      expect(f.api.createFile).toHaveBeenCalledWith("/", "dup");
      input.value = "fresh";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(app.sidebar.isCreating).toBe(false));
    });

    it("newFile with an empty list creates in the default folder", async () => {
      const f = fakeApi(defaultState(), {});
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      app.handleMenuAction({ type: "newFile" });
      const input = app.shell.list.querySelector<HTMLInputElement>(".sidebar__new-input")!;
      input.value = "n";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(f.api.createFile).toHaveBeenCalledWith(null, "n"));
    });

    it("find/replace open the search panel on the active file only", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      app.handleMenuAction({ type: "find" });
      expect(app.shell.editorHost.querySelector(".cm-search")).not.toBeNull();
      await app.removeFile("/a.md");
      await app.removeFile("/b.md");
      app.handleMenuAction({ type: "replace" });
      expect(app.shell.editorHost.querySelector(".cm-search")).toBeNull();
    });

    it("toggleSidebar and zoom patch the view state within limits", async () => {
      const f = fakeApi(defaultState(), {});
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      app.handleMenuAction({ type: "toggleSidebar" });
      expect(app.store.get().sidebarVisible).toBe(false);
      expect(document.documentElement.classList.contains("sidebar-hidden")).toBe(true);
      app.handleMenuAction({ type: "toggleSidebar" });
      expect(app.store.get().sidebarVisible).toBe(true);
      app.handleMenuAction({ type: "zoomIn" });
      expect(app.store.get().fontSize).toBe(15);
      app.handleMenuAction({ type: "zoomOut" });
      app.handleMenuAction({ type: "zoomOut" });
      expect(app.store.get().fontSize).toBe(13);
      app.handleMenuAction({ type: "zoomReset" });
      expect(app.store.get().fontSize).toBe(14);
      for (let i = 0; i < 50; i++) app.handleMenuAction({ type: "zoomIn" });
      expect(app.store.get().fontSize).toBe(48);
      for (let i = 0; i < 80; i++) app.handleMenuAction({ type: "zoomOut" });
      expect(app.store.get().fontSize).toBe(8);
      expect(document.documentElement.style.getPropertyValue("--te-font-size")).toBe("8px");
    });

    it("openSettings toggles the panel; its controls patch theme, font size and highlighting; Esc gives focus back", async () => {
      const f = fakeApi({ ...twoFiles(), activePath: null }, { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      expect(app.settings.visible).toBe(false);
      f.menu({ type: "openSettings" });
      expect(app.settings.visible).toBe(true);
      expect(app.shell.settingsHost.hidden).toBe(false);

      const slider = app.shell.settingsHost.querySelector<HTMLInputElement>(".settings__font")!;
      expect(slider.value).toBe("14");
      slider.value = "18";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      expect(app.store.get().fontSize).toBe(18);
      expect(document.documentElement.style.getPropertyValue("--te-font-size")).toBe("18px");
      expect(f.api.patchState).toHaveBeenLastCalledWith({ fontSize: 18 });

      // Highlighting off: persisted and flagged on <html> so the CSS can neutralise the syntax classes.
      const box = app.shell.settingsHost.querySelector<HTMLInputElement>("#settings-highlight")!;
      expect(box.checked).toBe(true);
      box.checked = false;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      expect(app.store.get().highlight).toBe(false);
      expect(document.documentElement.classList.contains("highlight-off")).toBe(true);
      expect(f.api.patchState).toHaveBeenLastCalledWith({ highlight: false });
      box.checked = true;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      expect(app.store.get().highlight).toBe(true);
      expect(document.documentElement.classList.contains("highlight-off")).toBe(false);

      // Zoom from the menu moves the slider 1 px at a time.
      app.handleMenuAction({ type: "zoomOut" });
      expect(app.store.get().fontSize).toBe(17);
      expect(slider.value).toBe("17");
      app.handleMenuAction({ type: "zoomOut" });
      app.handleMenuAction({ type: "zoomOut" });
      expect(slider.value).toBe("15");

      const fixed = app.shell.settingsHost.querySelector<HTMLInputElement>("#settings-mode-fixed")!;
      fixed.checked = true;
      fixed.dispatchEvent(new Event("change", { bubbles: true }));
      expect(app.store.get().theme.mode).toBe("fixed");
      const select = app.shell.settingsHost.querySelector<HTMLSelectElement>(".settings__fixed")!;
      expect(select.disabled).toBe(false);
      select.value = "tokyo-night";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      expect(app.store.get().theme).toMatchObject({ mode: "fixed", fixed: "tokyo-night" });
      expect(document.documentElement.dataset["theme"]).toBe("tokyo-night");

      // A user theme appearing in the folder shows up in the selects without reopening.
      f.themes([...BUILTIN_THEMES, { ...MEADOW, id: "mine", name: "Mine", builtin: false }]);
      expect([...select.options].map((o) => o.value)).toContain("mine");

      f.menu({ type: "openSettings" });
      expect(app.settings.visible).toBe(false);

      await app.openFile("/a.md");
      app.settings.open();
      const focus = vi.spyOn(app.editor.view, "focus");
      app.shell.settingsHost.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(app.settings.visible).toBe(false);
      expect(focus).toHaveBeenCalledTimes(1);
    });

    it("right-clicking a sidebar entry asks main for the native menu", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      app.shell.list
        .querySelector<HTMLElement>(".sidebar__item")!
        .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      expect(f.api.showFileMenu).toHaveBeenCalledWith("/a.md");
    });

    it("dropping files anywhere adds them and highlights the sidebar meanwhile", async () => {
      const win = new EventTarget() as unknown as Window;
      const f = fakeApi(defaultState(), {});
      const app = await boot(document.createElement("div"), f.api, { win, doc: document });
      apps.push(app);
      const ev = (type: string, files: File[] = []) => {
        const e = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(e, "dataTransfer", { value: { types: ["Files"], files, dropEffect: "none" } });
        return e;
      };
      win.dispatchEvent(ev("dragenter"));
      expect(app.shell.sidebar.classList.contains("is-dragover")).toBe(true);
      win.dispatchEvent(ev("drop", [new File(["x"], "n.md")]));
      expect(app.shell.sidebar.classList.contains("is-dragover")).toBe(false);
      expect(f.api.addFiles).toHaveBeenCalledWith(["/dropped/n.md"]);
      app.dispose();
      win.dispatchEvent(ev("dragenter"));
      expect(app.shell.sidebar.classList.contains("is-dragover")).toBe(false);
    });
  });

  describe("sidebar reorder and divider", () => {
    it("reordering persists the new file order", async () => {
      const f = fakeApi(twoFiles(), { "/a.md": "aaa", "/b.md": "bbb" });
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      const items = app.shell.list.querySelectorAll<HTMLElement>(".sidebar__item");
      items[0]!.getBoundingClientRect = () => ({ top: 0, height: 20 }) as DOMRect;
      const e = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(e, "clientY", { value: 2 });
      Object.defineProperty(e, "dataTransfer", {
        value: { types: ["application/x-tiny-edit-path"], getData: () => "/b.md", dropEffect: "none" },
      });
      items[0]!.dispatchEvent(e);
      expect(app.store.get().files.map((x) => x.path)).toEqual(["/b.md", "/a.md"]);
      expect(f.state().files.map((x) => x.path)).toEqual(["/b.md", "/a.md"]);
      expect([...app.shell.list.querySelectorAll(".sidebar__item")].map((i) => i.textContent)).toEqual([
        "b",
        "a",
      ]);
    });

    it("dragging the divider previews the width live and commits it to state", async () => {
      const win = new EventTarget() as unknown as Window;
      const f = fakeApi(defaultState(), {});
      const app = await boot(document.createElement("div"), f.api, { win, doc: document });
      apps.push(app);
      const mouse = (t: EventTarget, type: string, clientX: number) =>
        t.dispatchEvent(new MouseEvent(type, { clientX, button: 0, bubbles: true, cancelable: true }));
      mouse(app.shell.divider, "mousedown", 200);
      mouse(win, "mousemove", 260);
      expect(document.documentElement.style.getPropertyValue("--te-sidebar-width")).toBe("260px");
      expect(app.store.get().sidebarWidth).toBe(200);
      mouse(win, "mouseup", 260);
      expect(app.store.get().sidebarWidth).toBe(260);
      expect(f.state().sidebarWidth).toBe(260);
    });
  });

  describe("themes", () => {
    const surface = () => document.documentElement.style.getPropertyValue("--te-surface");

    it("paints the resolved theme at boot (auto + light appearance → macOS Light)", async () => {
      const f = fakeApi(defaultState(), {});
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      expect(app.currentTheme().id).toBe("macos-light");
      expect(surface()).toBe("#ffffff");
      expect(document.documentElement.dataset["appearance"]).toBe("light");
    });

    it("menu actions switch fixed theme, back to automatic, and change the automatic pair", async () => {
      const f = fakeApi(defaultState(), {});
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      app.handleMenuAction({ type: "setTheme", id: "tokyo-night" });
      expect(app.currentTheme().id).toBe("tokyo-night");
      expect(surface()).toBe("#1a1b26");
      expect(f.state().theme).toMatchObject({ mode: "fixed", fixed: "tokyo-night" });
      app.handleMenuAction({ type: "setThemeMode", mode: "auto" });
      expect(app.currentTheme().id).toBe("macos-light");
      app.handleMenuAction({ type: "setAutoTheme", appearance: "light", id: "catppuccin-latte" });
      expect(app.currentTheme().id).toBe("catppuccin-latte");
      expect(f.state().theme).toMatchObject({ mode: "auto", light: "catppuccin-latte" });
    });

    it("follows the OS appearance in automatic mode and picks up hot-reloaded user themes", async () => {
      const f = fakeApi(defaultState(), {});
      const app = await boot(document.createElement("div"), f.api);
      apps.push(app);
      f.appearance("dark");
      expect(app.currentTheme().id).toBe("macos-dark");
      expect(surface()).toBe("#1e1e1e");
      app.handleMenuAction({ type: "setTheme", id: "mine" }); // not known yet → falls back
      expect(app.currentTheme().id).toBe("macos-light");
      const mine: Theme = {
        ...MEADOW,
        id: "mine",
        name: "Mine",
        builtin: false,
        tokens: { ...MEADOW.tokens, colors: { ...MEADOW.tokens.colors, surface: "#123456" } },
      };
      f.themes([...BUILTIN_THEMES, mine]);
      expect(app.currentTheme().id).toBe("mine");
      expect(surface()).toBe("#123456");
      app.dispose();
      f.themes([...BUILTIN_THEMES]);
      expect(surface()).toBe("#123456"); // unsubscribed
    });
  });
});
