import { openSearchPanel } from "@codemirror/search";
import type { Api, MenuAction } from "../shared/ipc";
import { DEFAULT_FONT_SIZE, FONT_SIZE_RANGE, SIDEBAR_WIDTH_RANGE, type AppState } from "../shared/state";
import { displayName, parentDir } from "../shared/text";
import { resolveTheme, type Appearance, type Theme } from "../shared/themes";
import { parseToc, type Heading } from "../shared/toc";
import { applyTheme } from "./theme/apply";
import { installDivider } from "./divider";
import { installDropzone } from "./dropzone";
import { Autosave, type FileMeta } from "./autosave";
import { copyButtons } from "./editor/copy";
import { Editor } from "./editor/editor";
import type { ScopeRange } from "./editor/scope";
import { Notice } from "./notice";
import { Settings } from "./settings/settings";
import { reorder, Sidebar } from "./sidebar/sidebar";
import { Store } from "./store";

export type Shell = {
  sidebar: HTMLElement;
  list: HTMLElement;
  divider: HTMLElement;
  editorHost: HTMLElement;
  noticeHost: HTMLElement;
  settingsHost: HTMLElement;
};

/** Builds the static shell: sidebar on the left, notice bar + editor host on the right, settings overlay. */
export function mount(root: HTMLElement): Shell {
  root.replaceChildren();

  const sidebar = el("aside", "sidebar");
  const list = el("ul", "sidebar__list");
  const divider = el("div", "sidebar__divider");
  divider.setAttribute("role", "separator");
  divider.setAttribute("aria-orientation", "vertical");
  sidebar.append(el("div", "sidebar__header"), list, divider);

  const editor = el("main", "editor");
  const noticeHost = el("div", "editor__notice");
  const editorHost = el("div", "editor__host");
  editor.append(el("div", "editor__titlebar"), noticeHost, editorHost);

  const settingsHost = el("div", "settings");
  root.append(sidebar, editor, settingsHost);
  return { sidebar, list, divider, editorHost, noticeHost, settingsHost };
}

/** Pushes persisted view settings into CSS variables on the root element. */
export function applyViewState(
  root: HTMLElement,
  state: Pick<AppState, "sidebarWidth" | "sidebarVisible" | "fontSize">,
): void {
  root.style.setProperty("--te-sidebar-width", state.sidebarVisible ? `${state.sidebarWidth}px` : "0px");
  root.style.setProperty("--te-font-size", `${state.fontSize}px`);
  root.classList.toggle("sidebar-hidden", !state.sidebarVisible);
}

export type App = {
  shell: Shell;
  store: Store;
  editor: Editor;
  sidebar: Sidebar;
  notice: Notice;
  settings: Settings;
  autosave: Autosave;
  meta: Map<string, FileMeta>;
  missing: Set<string>;
  /** Cached H1/H2 outline per loaded file, driving the sidebar chevrons and section scoping. */
  tocs: Map<string, Heading[]>;
  openFile: (path: string, scope?: ScopeRange | null) => Promise<void>;
  /** Re-read a file from disk into the editor (conflict "Reload", external change). */
  reloadFile: (path: string) => Promise<void>;
  /** Remove from the list after saving pending edits; opens a neighbour if it was active. */
  removeFile: (path: string) => Promise<void>;
  handleMenuAction: (action: MenuAction) => void;
  /** The theme currently painted. */
  currentTheme: () => Theme;
  conflicts: Set<string>;
  dispose: () => void;
};

export const MISSING_MESSAGE = "File not found — typing will recreate it";
export const CONFLICT_MESSAGE = "Changed on disk";

export type BootOptions = { win?: Pick<Window, "addEventListener" | "removeEventListener">; doc?: Document };

/** Startup: mount the shell, load state, wire sidebar ↔ editor ↔ autosave, open the last active file. */
export async function boot(root: HTMLElement, api: Api, opts: BootOptions = {}): Promise<App> {
  const win = opts.win ?? window;
  const doc = opts.doc ?? document;
  const shell = mount(root);
  const initial = await api.getState();
  applyViewState(doc.documentElement, initial);

  const store = new Store(initial, (patch) => api.patchState(patch));

  let { themes, appearance } = await api.listThemes();
  const paintTheme = (): void =>
    applyTheme(doc.documentElement, resolveTheme(store.get().theme, themes, appearance));
  paintTheme();
  const notice = new Notice(shell.noticeHost);
  const settings = new Settings(shell.settingsHost, {
    onTheme: (theme) => store.patch({ theme }),
    onFontSize: (fontSize) => store.patch({ fontSize }),
    onClose: () => {
      if (editor.currentPath) editor.view.focus();
    },
  });
  const syncSettings = (): void =>
    settings.update({ theme: store.get().theme, fontSize: store.get().fontSize, themes });
  syncSettings();
  const missing = new Set<string>();
  /** Files whose disk copy changed while they had unsaved edits; the bar shows when they are active. */
  const conflicts = new Set<string>();
  const meta = new Map<string, FileMeta>();
  const tocs = new Map<string, Heading[]>();
  const tocTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Recompute a loaded file's outline from its current buffer (or forget it when unloaded). */
  function refreshToc(path: string): void {
    const text = editor.text(path);
    if (text == null) tocs.delete(path);
    else tocs.set(path, parseToc(text));
  }

  /** Debounced outline refresh on typing — off the keystroke path, then re-render the sidebar. */
  function scheduleToc(path: string): void {
    const existing = tocTimers.get(path);
    if (existing) clearTimeout(existing);
    tocTimers.set(
      path,
      setTimeout(() => {
        tocTimers.delete(path);
        refreshToc(path);
        render();
      }, 200),
    );
  }

  const editor = new Editor(shell.editorHost, {
    hooks: {
      onViewChange: (path, view) => store.setFileView(path, view),
      onDocChange: (path) => {
        autosave.markDirty(path);
        scheduleToc(path);
      },
    },
    extensions: [copyButtons((text) => void api.copyText(text))],
  });

  const autosave = new Autosave({
    api,
    text: (path) => editor.text(path),
    meta,
    onSaved: (path) => {
      if (missing.delete(path)) {
        if (path === editor.currentPath && notice.message === MISSING_MESSAGE) notice.hide();
        render();
      }
    },
    onConflict: (path) => showConflict(path),
    onError: (path, err) => {
      console.error("[autosave]", path, err);
      if (path === editor.currentPath)
        notice.show(`Couldn't save ${displayName(path)}`, [
          { label: "Retry", onClick: () => void autosave.flush(path) },
        ]);
    },
  });

  function showConflict(path: string): void {
    conflicts.add(path);
    if (path !== editor.currentPath) return;
    notice.show(CONFLICT_MESSAGE, [
      {
        label: "Reload",
        onClick: () => {
          conflicts.delete(path);
          void autosave.resolve(path, "reload").then(() => reloadFile(path));
        },
      },
      {
        label: "Keep mine",
        onClick: () => {
          conflicts.delete(path);
          void autosave.resolve(path, "keep-mine").then(() => notice.hide());
        },
      },
    ]);
  }

  const sidebar = new Sidebar(shell.list, {
    onSelect: (path) => void openFile(path),
    onSelectHeading: (path, index) =>
      void openFile(path).then(() => {
        const heading = tocs.get(path)?.[index];
        if (heading) {
          editor.applyScope(path, { from: heading.from, to: heading.to });
          render();
        }
      }),
    onContextMenu: (path) => void api.showFileMenu(path),
    onCreate: async (name) => {
      const active = store.get().activePath;
      const result = await api.createFile(active ? parentDir(active) : null, name);
      return result.ok ? null : result.error;
    },
    onReorder: (path, target, position) => {
      store.patch({ files: reorder(store.get().files, path, target, position) });
      render();
    },
  });

  const uninstallDivider = installDivider(shell.divider, win, {
    getWidth: () => store.get().sidebarWidth,
    onPreview: (width) => doc.documentElement.style.setProperty("--te-sidebar-width", `${width}px`),
    onCommit: (width) => store.patch({ sidebarWidth: width }),
    min: SIDEBAR_WIDTH_RANGE.min,
    max: SIDEBAR_WIDTH_RANGE.max,
  });
  const render = (): void => {
    const s = store.get();
    const active = editor.currentPath;
    const scope = active ? editor.scopeOf(active) : null;
    sidebar.render(s.files, s.activePath, missing, tocs, scope);
  };

  async function load(path: string): Promise<{ text: string; large: boolean } | null> {
    try {
      const read = await api.readFile(path);
      meta.set(path, { eol: read.eol, bom: read.bom, stamp: read.stamp });
      missing.delete(path);
      return { text: read.text, large: read.large };
    } catch {
      missing.add(path);
      if (!meta.has(path)) meta.set(path, { eol: "\n", bom: false, stamp: null });
      return null;
    }
  }

  /** Show a file. `scope` null (the default) shows the whole file; a range narrows to a section. */
  async function openFile(path: string, scope: ScopeRange | null = null): Promise<void> {
    const file = store.fileState(path);
    if (!file) return;
    if (editor.currentPath && editor.currentPath !== path) await autosave.flush(editor.currentPath);
    store.setActive(path);
    render();
    notice.hide();
    if (editor.isOpen(path)) {
      editor.open(path, editor.text(path) ?? "", file);
      if (conflicts.has(path)) showConflict(path);
      else if (missing.has(path)) notice.show(MISSING_MESSAGE);
    } else {
      const loaded = await load(path);
      editor.open(path, loaded?.text ?? "", file);
      if (!loaded) notice.show(MISSING_MESSAGE);
      else if (loaded.large) notice.show("Large file — highlighting may be slower");
    }
    refreshToc(path);
    editor.applyScope(path, scope);
    render();
  }

  async function reloadFile(path: string): Promise<void> {
    const loaded = await load(path);
    if (loaded) {
      editor.replaceText(path, loaded.text);
      refreshToc(path);
      if (path === editor.currentPath) notice.hide();
    } else if (path === editor.currentPath) notice.show(MISSING_MESSAGE);
    render();
  }

  async function removeFile(path: string): Promise<void> {
    if (!store.fileState(path)) return;
    await autosave.flush(path);
    const wasActive = editor.currentPath === path;
    const files = store.get().files;
    const index = files.findIndex((f) => f.path === path);
    const neighbour = files[index + 1] ?? files[index - 1] ?? null;
    store.replace(await api.removeFile(path));
    editor.close(path);
    autosave.forget(path);
    missing.delete(path);
    conflicts.delete(path);
    meta.delete(path);
    tocs.delete(path);
    notice.hide();
    render();
    if (wasActive && neighbour) await openFile(neighbour.path);
  }

  function handleMenuAction(action: MenuAction): void {
    switch (action.type) {
      case "newFile":
        sidebar.showNewFileInput();
        break;
      case "closeFile": {
        const active = editor.currentPath;
        if (active) void removeFile(active);
        break;
      }
      case "removeFile":
        void removeFile(action.path);
        break;
      case "find":
      case "replace":
        if (editor.currentPath) {
          editor.view.focus();
          openSearchPanel(editor.view);
        }
        break;
      case "toggleSidebar":
        store.patch({ sidebarVisible: !store.get().sidebarVisible });
        break;
      case "openSettings":
        settings.toggle();
        break;
      case "setThemeMode":
        store.patch({ theme: { ...store.get().theme, mode: "auto" } });
        break;
      case "setTheme":
        store.patch({ theme: { ...store.get().theme, mode: "fixed", fixed: action.id } });
        break;
      case "setAutoTheme":
        store.patch({ theme: { ...store.get().theme, mode: "auto", [action.appearance]: action.id } });
        break;
      case "zoomIn":
      case "zoomOut":
      case "zoomReset": {
        const current = store.get().fontSize;
        const next =
          action.type === "zoomReset" ? DEFAULT_FONT_SIZE : current + (action.type === "zoomIn" ? 1 : -1);
        store.patch({ fontSize: Math.min(FONT_SIZE_RANGE.max, Math.max(FONT_SIZE_RANGE.min, next)) });
        break;
      }
    }
  }

  const uninstallDrop = installDropzone(win, {
    pathForFile: (file) => api.pathForFile(file),
    onPaths: (paths) => void api.addFiles(paths),
    onDragState: (over) => sidebar.setDragOver(over),
  });

  const flushAll = (): void => void autosave.flush();
  const onVisibility = (): void => {
    if (doc.visibilityState === "hidden") flushAll();
  };
  win.addEventListener("blur", flushAll);
  doc.addEventListener("visibilitychange", onVisibility);

  const unsubscribeStore = store.subscribe(() => {
    applyViewState(doc.documentElement, store.get());
    paintTheme();
    syncSettings();
  });
  const unsubscribeThemes = api.onThemesChanged((list: Theme[]) => {
    themes = list;
    paintTheme();
    syncSettings();
  });
  const unsubscribeAppearance = api.onAppearanceChanged((next: Appearance) => {
    appearance = next;
    paintTheme();
  });
  const unsubscribeOpened = api.onFilesOpened(async ({ paths }) => {
    store.replace(await api.getState());
    render();
    const first = paths[0];
    if (first && store.fileState(first)) await openFile(first);
  });
  const unsubscribeFlush = api.onFlushRequest(() => {
    autosave.flush().finally(() => void api.flushed());
  });
  const unsubscribeMenu = api.onMenuAction((action) => handleMenuAction(action));
  const unsubscribeChanged = api.onWatchChanged(({ path }) => {
    if (!store.fileState(path) || !editor.isOpen(path)) return; // not loaded yet: the next open reads fresh
    if (autosave.isDirty(path)) {
      autosave.park(path);
      showConflict(path);
    } else void reloadFile(path);
  });
  const unsubscribeMissing = api.onWatchMissing(({ path }) => {
    if (!store.fileState(path)) return;
    missing.add(path);
    const m = meta.get(path);
    if (m) meta.set(path, { ...m, stamp: null });
    if (path === editor.currentPath && !conflicts.has(path)) notice.show(MISSING_MESSAGE);
    render();
  });

  render();
  if (initial.activePath) await openFile(initial.activePath);

  return {
    shell,
    store,
    editor,
    sidebar,
    notice,
    settings,
    autosave,
    meta,
    missing,
    tocs,
    openFile,
    reloadFile,
    removeFile,
    handleMenuAction,
    currentTheme: () => resolveTheme(store.get().theme, themes, appearance),
    conflicts,
    dispose: () => {
      unsubscribeStore();
      unsubscribeOpened();
      unsubscribeFlush();
      unsubscribeChanged();
      unsubscribeMissing();
      unsubscribeMenu();
      unsubscribeThemes();
      unsubscribeAppearance();
      uninstallDrop();
      uninstallDivider();
      for (const timer of tocTimers.values()) clearTimeout(timer);
      win.removeEventListener("blur", flushAll);
      doc.removeEventListener("visibilitychange", onVisibility);
      editor.destroy();
    },
  };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}
