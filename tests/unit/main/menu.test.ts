import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";
import { fileContextTemplate, menuTemplate, themeSubmenu } from "../../../src/main/menu";
import { BUILTIN_THEMES, MEADOW } from "../../../src/shared/themes";

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? flatten(i.submenu) : [])]);
}
const byId = (items: MenuItemConstructorOptions[], id: string) => flatten(items).find((i) => i.id === id)!;
const click = (item: MenuItemConstructorOptions) => (item.click as () => void)();
const themeState = { mode: "auto" as const, light: "meadow", dark: "catppuccin-mocha", fixed: "meadow" };
const base = () => ({
  send: vi.fn(),
  openDialog: vi.fn(),
  isDev: false,
  themes: BUILTIN_THEMES,
  themeState,
  openThemesFolder: vi.fn(),
  canFormat: true,
  recentItems: [] as { path: string; label: string }[],
  openRecent: vi.fn(),
});

describe("menuTemplate", () => {
  it("has the standard macOS structure with roles", () => {
    const t = menuTemplate(base());
    expect(t.map((m) => m.role ?? m.label)).toEqual([
      "Tiny Edit",
      "File",
      "Edit",
      "View",
      "windowMenu",
      "help",
    ]);
    const roles = flatten(t)
      .map((i) => i.role)
      .filter(Boolean);
    expect(roles).toEqual(
      expect.arrayContaining([
        "about",
        "services",
        "hide",
        "hideOthers",
        "unhide",
        "quit",
        "undo",
        "redo",
        "cut",
        "copy",
        "paste",
        "selectAll",
      ]),
    );
    expect(roles).not.toContain("toggleDevTools");
  });

  it("puts Settings… in the app menu with Cmd+,", () => {
    const deps = base();
    const t = menuTemplate(deps);
    const appMenu = t[0]!.submenu as MenuItemConstructorOptions[];
    expect(appMenu.map((i) => i.role ?? i.id ?? i.type)).toEqual([
      "about",
      "separator",
      "settings",
      "separator",
      "services",
      "separator",
      "hide",
      "hideOthers",
      "unhide",
      "separator",
      "quit",
    ]);
    const settings = byId(t, "settings");
    expect(settings.label).toBe("Settings…");
    expect(settings.accelerator).toBe("CmdOrCtrl+,");
    click(settings);
    expect(deps.send).toHaveBeenCalledWith({ type: "openSettings" });
  });

  it("Help → What's New relays showWhatsNew", () => {
    const deps = base();
    const item = byId(menuTemplate(deps), "whats-new");
    expect(item.label).toBe("What's New");
    click(item);
    expect(deps.send).toHaveBeenCalledWith({ type: "showWhatsNew" });
  });

  it("puts the Theme submenu in View", () => {
    const t = menuTemplate(base());
    const theme = byId(t, "theme");
    expect(theme.label).toBe("Theme");
    expect(Array.isArray(theme.submenu)).toBe(true);
    expect(byId(t, "theme-tokyo-night")).toBeDefined();
    expect(byId(t, "open-themes-folder")).toBeDefined();
  });

  it("adds developer items only in dev", () => {
    const t = menuTemplate({ ...base(), isDev: true });
    expect(flatten(t).map((i) => i.role)).toEqual(expect.arrayContaining(["toggleDevTools", "reload"]));
  });

  it("relays every app-specific item as a MenuAction with the agreed accelerators", () => {
    const deps = base();
    const { send, openDialog } = deps;
    const t = menuTemplate(deps);
    const expected: [string, string, unknown][] = [
      ["new-file", "CmdOrCtrl+N", { type: "newFile" }],
      ["close-file", "CmdOrCtrl+W", { type: "closeFile" }],
      ["find", "CmdOrCtrl+F", { type: "find" }],
      ["replace", "CmdOrCtrl+Alt+F", { type: "replace" }],
      ["toggle-sidebar", "CmdOrCtrl+\\", { type: "toggleSidebar" }],
      ["zoom-in", "CmdOrCtrl+=", { type: "zoomIn" }],
      ["zoom-out", "CmdOrCtrl+-", { type: "zoomOut" }],
      ["zoom-reset", "CmdOrCtrl+0", { type: "zoomReset" }],
    ];
    for (const [id, accelerator, action] of expected) {
      const item = byId(t, id);
      expect(item.accelerator, id).toBe(accelerator);
      click(item);
      expect(send).toHaveBeenLastCalledWith(action);
    }
    const open = byId(t, "open-file");
    expect(open.accelerator).toBe("CmdOrCtrl+O");
    click(open);
    expect(openDialog).toHaveBeenCalledTimes(1);
  });

  it("File → Recently Closed is a disabled placeholder when empty", () => {
    const item = byId(menuTemplate(base()), "recently-closed");
    expect(item.label).toBe("Recently Closed");
    expect(item.enabled).toBe(false);
    expect(item.submenu).toBeUndefined();
  });

  it("File → Recently Closed lists each entry and opens it on click", () => {
    const deps = {
      ...base(),
      recentItems: [
        { path: "/a/todo.md", label: "todo.md — ~/a" },
        { path: "/b/todo.md", label: "todo.md — ~/b" },
      ],
    };
    const item = byId(menuTemplate(deps), "recently-closed");
    const sub = item.submenu as MenuItemConstructorOptions[];
    expect(sub.map((i) => i.label)).toEqual(["todo.md — ~/a", "todo.md — ~/b"]);
    click(sub[1]!);
    expect(deps.openRecent).toHaveBeenCalledWith("/b/todo.md");
  });

  it("Edit → Pretty Format relays prettyFormat and is enabled only when canFormat", () => {
    const deps = base();
    const item = byId(menuTemplate(deps), "pretty-format");
    expect(item.label).toBe("Pretty Format");
    expect(item.accelerator).toBe("Shift+Alt+F");
    expect(item.enabled).toBe(true);
    click(item);
    expect(deps.send).toHaveBeenCalledWith({ type: "prettyFormat" });
    expect(byId(menuTemplate({ ...base(), canFormat: false }), "pretty-format").enabled).toBe(false);
  });
});

describe("fileContextTemplate", () => {
  it("offers remove / reveal / copy for the given path", () => {
    const deps = { send: vi.fn(), reveal: vi.fn(), copyPath: vi.fn() };
    const t = fileContextTemplate("/x/a.md", deps);
    expect(t.map((i) => i.label ?? i.type)).toEqual([
      "Remove from Sidebar",
      "separator",
      "Reveal in Finder",
      "Copy Path",
    ]);
    click(byId(t, "ctx-remove"));
    expect(deps.send).toHaveBeenCalledWith({ type: "removeFile", path: "/x/a.md" });
    click(byId(t, "ctx-reveal"));
    expect(deps.reveal).toHaveBeenCalledWith("/x/a.md");
    click(byId(t, "ctx-copy"));
    expect(deps.copyPath).toHaveBeenCalledWith("/x/a.md");
  });
});

describe("themeSubmenu", () => {
  it("lists Automatic + every theme as radios, with the pair submenus and the folder item", () => {
    const deps = {
      send: vi.fn(),
      themes: [...BUILTIN_THEMES, { ...MEADOW, id: "mine", name: "Mine", builtin: false }],
      themeState,
      openThemesFolder: vi.fn(),
    };
    const items = themeSubmenu(deps);
    expect(items[0]).toMatchObject({ id: "theme-auto", type: "radio", checked: true });
    expect(
      items.filter((i) => i.id?.startsWith("theme-") && i.id !== "theme-auto").map((i) => i.label),
    ).toEqual([
      "Meadow",
      "Tokyo Night",
      "Catppuccin Latte",
      "Catppuccin Frappé",
      "Catppuccin Macchiato",
      "Catppuccin Mocha",
      "macOS Light",
      "macOS Dark",
      "Mine (custom)",
    ]);
    expect(items.filter((i) => i.type === "radio" && i.checked)).toHaveLength(1);
    click(byId(items, "theme-tokyo-night"));
    expect(deps.send).toHaveBeenCalledWith({ type: "setTheme", id: "tokyo-night" });
    click(byId(items, "theme-auto"));
    expect(deps.send).toHaveBeenCalledWith({ type: "setThemeMode", mode: "auto" });

    const light = byId(items, "auto-light").submenu as MenuItemConstructorOptions[];
    const dark = byId(items, "auto-dark").submenu as MenuItemConstructorOptions[];
    expect(light.map((i) => i.label)).toEqual(["Meadow", "Catppuccin Latte", "macOS Light", "Mine (custom)"]);
    expect(light.find((i) => i.checked)?.id).toBe("auto-light-meadow");
    expect(dark.find((i) => i.checked)?.id).toBe("auto-dark-catppuccin-mocha");
    click(byId(items, "auto-dark-tokyo-night"));
    expect(deps.send).toHaveBeenCalledWith({ type: "setAutoTheme", appearance: "dark", id: "tokyo-night" });
    click(byId(items, "open-themes-folder"));
    expect(deps.openThemesFolder).toHaveBeenCalledTimes(1);
  });

  it("checks the fixed theme when not automatic", () => {
    const items = themeSubmenu({
      send: vi.fn(),
      themes: BUILTIN_THEMES,
      themeState: { ...themeState, mode: "fixed", fixed: "catppuccin-latte" },
      openThemesFolder: vi.fn(),
    });
    expect(byId(items, "theme-auto").checked).toBe(false);
    expect(byId(items, "theme-catppuccin-latte").checked).toBe(true);
  });
});
