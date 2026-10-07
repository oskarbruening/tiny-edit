import type { MenuItemConstructorOptions } from "electron";
import type { MenuAction } from "../shared/ipc";
import type { ThemeState } from "../shared/state";
import type { Theme } from "../shared/themes";

export type MenuDeps = {
  /** Relay a command to the renderer. */
  send: (action: MenuAction) => void;
  /** File → Open… */
  openDialog: () => void;
  isDev: boolean;
  themes: readonly Theme[];
  themeState: ThemeState;
  openThemesFolder: () => void;
};

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
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
        { id: "new-file", label: "New File", accelerator: "CmdOrCtrl+N", click: relay({ type: "newFile" }) },
        { id: "open-file", label: "Open…", accelerator: "CmdOrCtrl+O", click: () => openDialog() },
        { type: "separator" },
        {
          id: "close-file",
          label: "Close File",
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
    { id: "ctx-remove", label: "Remove from List", click: () => deps.send({ type: "removeFile", path }) },
    { type: "separator" },
    { id: "ctx-reveal", label: "Reveal in Finder", click: () => deps.reveal(path) },
    { id: "ctx-copy", label: "Copy Path", click: () => deps.copyPath(path) },
  ];
}
