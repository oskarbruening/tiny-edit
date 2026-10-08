import type { MenuItemConstructorOptions } from "electron";
import type { MenuAction } from "../shared/ipc";
import type { ThemeState } from "../shared/state";
import type { Theme } from "../shared/themes";
import { APP_NAME } from "../shared/constants";

export type MenuDeps = {
  /** Relay a command to the renderer. */
  send: (action: MenuAction) => void;
  /** File → Open… */
  openDialog: () => void;
  isDev: boolean;
  themes: readonly Theme[];
  themeState: ThemeState;
  openThemesFolder: () => void;
  /** Edit → Pretty Format is enabled only when the active file is Markdown/JSON/HTML/XML. */
  canFormat: boolean;
  /** File → Recently Closed entries (most recent first) with display labels. */
  recentItems: readonly { path: string; label: string }[];
  /** Re-open a recently-closed file. */
  openRecent: (path: string) => void;
};

/** File → Recently Closed: one item per remembered path, or a disabled placeholder when empty. */
function recentlyClosedSubmenu(
  items: readonly { path: string; label: string }[],
  openRecent: (path: string) => void,
): MenuItemConstructorOptions {
  if (items.length === 0) return { id: "recently-closed", label: "Recently Closed", enabled: false };
  return {
    id: "recently-closed",
    label: "Recently Closed",
    submenu: items.map((item, i) => ({
      id: `recent-${i}`,
      label: item.label,
      click: () => openRecent(item.path),
    })),
  };
}

/** View → Theme: Automatic or one fixed theme; the Automatic pair is chosen in two submenus. */
export function themeSubmenu(
  deps: Pick<MenuDeps, "send" | "themes" | "themeState" | "openThemesFolder">,
): MenuItemConstructorOptions[] {
  const { themes, themeState: t, send } = deps;
  const auto = t.mode === "auto";
  const label = (theme: Theme) => (theme.builtin ? theme.name : `${theme.name} (custom)`);
  const pick = (appearance: "light" | "dark", current: string): MenuItemConstructorOptions[] =>
    themes
      .filter((theme) => theme.appearance === appearance)
      .map((theme) => ({
        id: `auto-${appearance}-${theme.id}`,
        label: label(theme),
        type: "radio",
        checked: theme.id === current,
        click: () => send({ type: "setAutoTheme", appearance, id: theme.id }),
      }));
  return [
    {
      id: "theme-auto",
      label: "Automatic (follows macOS)",
      type: "radio",
      checked: auto,
      click: () => send({ type: "setThemeMode", mode: "auto" }),
    },
    ...themes.map((theme): MenuItemConstructorOptions => ({
      id: `theme-${theme.id}`,
      label: label(theme),
      type: "radio",
      checked: !auto && theme.id === t.fixed,
      click: () => send({ type: "setTheme", id: theme.id }),
    })),
    { type: "separator" },
    { id: "auto-light", label: "Light Theme for Automatic", submenu: pick("light", t.light) },
    { id: "auto-dark", label: "Dark Theme for Automatic", submenu: pick("dark", t.dark) },
    { type: "separator" },
    { id: "open-themes-folder", label: "Open Themes Folder", click: () => deps.openThemesFolder() },
  ];
}

/**
 * The macOS application menu. Standard roles where they exist; everything app-specific is
 * relayed to the renderer as a MenuAction. Accelerators here take precedence over the
 * page, which is why Find lives here too (it must work while the sidebar has focus).
 * The app menu is spelled out (not `role: "appMenu"`) so Settings… can sit in its usual place.
 */
export function menuTemplate(deps: MenuDeps): MenuItemConstructorOptions[] {
  const { send, openDialog, isDev } = deps;
  const relay = (action: MenuAction) => () => send(action);
  const view: MenuItemConstructorOptions[] = [
    {
      id: "toggle-sidebar",
      label: "Toggle Sidebar",
      accelerator: "CmdOrCtrl+\\",
      click: relay({ type: "toggleSidebar" }),
    },
    { id: "theme", label: "Theme", submenu: themeSubmenu(deps) },
    { type: "separator" },
    { id: "zoom-in", label: "Zoom In", accelerator: "CmdOrCtrl+=", click: relay({ type: "zoomIn" }) },
    { id: "zoom-out", label: "Zoom Out", accelerator: "CmdOrCtrl+-", click: relay({ type: "zoomOut" }) },
    {
      id: "zoom-reset",
      label: "Actual Size",
      accelerator: "CmdOrCtrl+0",
      click: relay({ type: "zoomReset" }),
    },
  ];
  if (isDev) view.push({ type: "separator" }, { role: "toggleDevTools" }, { role: "reload" });
  return [
    {
      label: APP_NAME,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          id: "settings",
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: relay({ type: "openSettings" }),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        { id: "new-file", label: "New File", accelerator: "CmdOrCtrl+N", click: relay({ type: "newFile" }) },
        { id: "open-file", label: "Open…", accelerator: "CmdOrCtrl+O", click: () => openDialog() },
        recentlyClosedSubmenu(deps.recentItems, deps.openRecent),
        { type: "separator" },
        {
          id: "close-file",
          label: "Remove from Sidebar",
          accelerator: "CmdOrCtrl+W",
          click: relay({ type: "closeFile" }),
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        {
          id: "pretty-format",
          label: "Pretty Format",
          accelerator: "Shift+Alt+F",
          enabled: deps.canFormat,
          click: relay({ type: "prettyFormat" }),
        },
        { type: "separator" },
        { id: "find", label: "Find", accelerator: "CmdOrCtrl+F", click: relay({ type: "find" }) },
        {
          id: "replace",
          label: "Find and Replace",
          accelerator: "CmdOrCtrl+Alt+F",
          click: relay({ type: "replace" }),
        },
      ],
    },
    { label: "View", submenu: view },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [{ id: "whats-new", label: "What's New", click: relay({ type: "showWhatsNew" }) }],
    },
  ];
}

/** The sidebar's right-click menu for one file. */
export function fileContextTemplate(
  path: string,
  deps: {
    send: (action: MenuAction) => void;
    reveal: (path: string) => void;
    copyPath: (path: string) => void;
  },
): MenuItemConstructorOptions[] {
  return [
    { id: "ctx-remove", label: "Remove from Sidebar", click: () => deps.send({ type: "removeFile", path }) },
    { type: "separator" },
    { id: "ctx-reveal", label: "Reveal in Finder", click: () => deps.reveal(path) },
    { id: "ctx-copy", label: "Copy Path", click: () => deps.copyPath(path) },
  ];
}
