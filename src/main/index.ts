// Wiring only. Logic lives in the sibling modules so it can be unit-tested without Electron.
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  protocol,
  screen,
  shell,
} from "electron";
import * as fs from "node:fs";
import { join } from "node:path";
import { createMainWindow } from "./window";
import { APP_SCHEME, createAppProtocolHandler, RENDERER_ORIGIN, RENDERER_URL } from "./appProtocol";
import { hardenWebContents } from "./security";
import { StateStore } from "./state";
import { openPaths, registerIpc, trustedSenderFor } from "./ipc";
import { fileContextTemplate, menuTemplate } from "./menu";
import { OpenQueue } from "./openQueue";
import { UserThemes } from "./themes";
import { BUILTIN_THEMES, resolveTheme, type Appearance } from "../shared/themes";
import { displayName } from "../shared/text";
import { APP_NAME } from "../shared/constants";
import { describeRejections, Files, type Rejection } from "./files";
import { FlushGate, guardClose } from "./flushGate";
import { Watcher } from "./watcher";
import { CHANNELS } from "../shared/ipc";
import { trackWindowState, validateBounds } from "./windowState";
import { USER_DATA_ENV } from "../shared/constants";

const userData = process.env[USER_DATA_ENV];
if (userData) app.setPath("userData", userData);

// Held keys repeat instead of opening the accent popover (Neo does the same).
if (process.platform === "darwin") app.commandLine.appendSwitch("disable-features", "ApplePressAndHold");

// The renderer's own scheme must be registered before `ready` (see appProtocol.ts).
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false },
  },
]);

// Finder double-clicks and Dock drops can arrive before `ready`; register first, drain later.
const openQueue = new OpenQueue();
app.on("open-file", (event, path) => {
  event.preventDefault();
  openQueue.push(path);
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const store = new StateStore({ filePath: join(app.getPath("userData"), "state.json"), fs });

  app.on("second-instance", () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on("web-contents-created", (_event, contents) => hardenWebContents(contents));

  app.whenReady().then(async () => {
    const state = store.load();
    protocol.handle(
      APP_SCHEME,
      createAppProtocolHandler({
        root: join(__dirname, "../renderer"),
        readFile: (p) => fs.promises.readFile(p),
      }),
    );
    const appearance = (): Appearance => (nativeTheme.shouldUseDarkColors ? "dark" : "light");
    const userThemes = new UserThemes({
      dir: join(app.getPath("userData"), "themes"),
      fs: { promises: fs.promises, watch: (dir, listener) => fs.watch(dir, listener) },
      onChange: (list) => {
        send(CHANNELS.themesChanged, allThemes());
        rebuildMenu();
        applyBackground();
        void list;
      },
    });
    await userThemes.start();
    const allThemes = () => [...BUILTIN_THEMES, ...userThemes.current];
    const currentTheme = () => resolveTheme(store.get().theme, allThemes(), appearance());
    const devUrl = process.env["ELECTRON_RENDERER_URL"];
    const rendererUrl = devUrl ?? RENDERER_URL;
    const flushGate = new FlushGate();
    const files = new Files(fs);
    const send = (channel: string, payload: unknown): void => {
      for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
    };
    const watcher = new Watcher({
      watch: (dir, listener) => fs.watch(dir, listener),
      stat: (path) => files.stat(path),
      onChanged: (path, stamp) => send(CHANNELS.watchChanged, { path, stamp }),
      onMissing: (path) => send(CHANNELS.watchMissing, { path }),
    });
    watcher.setPaths(state.files.map((f) => f.path));
    store.subscribe((s) => watcher.setPaths(s.files.map((f) => f.path)));
    const pickFiles = async (): Promise<string[]> => {
      const [win] = BrowserWindow.getAllWindows();
      const result = win
        ? await dialog.showOpenDialog(win, { properties: ["openFile", "multiSelections"] })
        : await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
      return result.canceled ? [] : result.filePaths;
    };
    const sendMenuAction = (action: unknown): void => send(CHANNELS.menuAction, action);
    /** Dropped / opened paths the app refused: say so instead of silently ignoring them. */
    const reportRejected = (rejected: Rejection[]): void => {
      const { message, detail } = describeRejections(rejected);
      const [win] = BrowserWindow.getAllWindows();
      const options = { type: "warning" as const, message, detail, buttons: ["OK"] };
      void (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
    };
    const openDeps = { files, store, send, onRejected: reportRejected };
    registerIpc({
      ipcMain,
      store,
      files,
      shell,
      clipboard,
      isTrustedSender: trustedSenderFor(devUrl ? [RENDERER_ORIGIN, devUrl] : [RENDERER_ORIGIN]),
      onRendererFlushed: (id, pending) => flushGate.notify(id, pending),
      onRejected: reportRejected,
      onFileStamp: (path, stamp) => watcher.recordStamp(path, stamp),
      showContextMenu: (path, relay) => {
        const template = fileContextTemplate(path, {
          send: relay,
          reveal: (p) => shell.showItemInFolder(p),
          copyPath: (p) => clipboard.writeText(p),
        });
        Menu.buildFromTemplate(template).popup();
      },
      pickFiles,
      defaultDir: () => app.getPath("documents"),
      themes: () => ({ themes: allThemes(), appearance: appearance() }),
    });
    const openThemesFolder = (): void => void shell.openPath(join(app.getPath("userData"), "themes"));
    const rebuildMenu = (): void =>
      Menu.setApplicationMenu(
        Menu.buildFromTemplate(
          menuTemplate({
            send: sendMenuAction,
            openDialog: () => void pickFiles().then((paths) => openPaths(paths, openDeps)),
            isDev: !app.isPackaged,
            themes: allThemes(),
            themeState: store.get().theme,
            openThemesFolder,
          }),
        ),
      );
    rebuildMenu();
    const win = createMainWindow(
      { BrowserWindow, rendererUrl },
      {
        preloadPath: join(__dirname, "../preload/index.js"),
        bounds: validateBounds(state.window, screen.getAllDisplays()),
        backgroundColor: currentTheme().tokens.colors.surface,
      },
    );
    /** The window paints this behind the page, so theme switches and launches never flash. */
    const applyBackground = (): void => win.setBackgroundColor(currentTheme().tokens.colors.surface);
    let lastThemeState = JSON.stringify(store.get().theme);
    store.subscribe((s) => {
      const now = JSON.stringify(s.theme);
      if (now === lastThemeState) return;
      lastThemeState = now;
      rebuildMenu();
      applyBackground();
    });
    nativeTheme.on("updated", () => {
      send(CHANNELS.appearanceChanged, appearance());
      applyBackground();
    });
    trackWindowState(win, { onChange: (bounds) => store.patch({ window: bounds }) });
    /** Quit with unsaved edits (a conflict bar still open, a failed save, a frozen renderer): ask first. */
    const confirmDiscard = async (unsaved: string[] | null): Promise<boolean> => {
      const names = unsaved?.map((p) => displayName(p)).join(", ");
      const { response } = await dialog.showMessageBox(win, {
        type: "warning",
        buttons: ["Cancel", "Quit Anyway"],
        defaultId: 0,
        cancelId: 0,
        message: unsaved ? `Changes to ${names} could not be saved` : "The editor is not responding",
        detail: unsaved
          ? "Quitting now discards those changes. Cancel to resolve the notice above the editor (Reload / Keep mine, or Retry) and quit again."
          : "Unsaved changes may be lost if you quit now.",
      });
      return response === 1;
    };
    guardClose(win, flushGate, () => store.flush(), confirmDiscard);
    win.on("focus", () => void watcher.checkAll());
    win.on("closed", () => {
      watcher.close();
      userThemes.close();
    });

    // Window title and proxy icon follow the active file.
    const reflectTitle = (path: string | null): void => {
      win.setTitle(path ? displayName(path) : APP_NAME);
      win.setRepresentedFilename(path ?? "");
    };
    reflectTitle(state.activePath);
    store.subscribe((s) => reflectTitle(s.activePath));

    openQueue.attach((paths) => void openPaths(paths, openDeps));
  });

  app.on("before-quit", () => store.flush());

  // Single-window, document-less app: closing the window quits, macOS included.
  app.on("window-all-closed", () => app.quit());
}
