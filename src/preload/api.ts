import {
  CHANNELS,
  type Api,
  type FilesOpened,
  type MenuAction,
  type ThemesList,
  type Versions,
  type WatchChanged,
  type WatchMissing,
} from "../shared/ipc";
import type { Appearance, Theme } from "../shared/themes";
import type { AppState, StatePatch } from "../shared/state";

export type PreloadDeps = {
  versions: Partial<Record<"electron" | "chrome" | "node", string>>;
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  pathForFile: (file: File) => string;
  on: (channel: string, listener: (event: unknown, payload: unknown) => void) => void;
  off: (channel: string, listener: (event: unknown, payload: unknown) => void) => void;
};

/** Pure: builds the object exposed as window.api. Never exposes ipcRenderer itself. */
export function createApi(deps: PreloadDeps): Api {
  const versions: Versions = {
    electron: deps.versions.electron ?? "",
    chrome: deps.versions.chrome ?? "",
    node: deps.versions.node ?? "",
  };
  const call = <T>(channel: string, ...args: unknown[]) => deps.invoke(channel, ...args) as Promise<T>;
  return {
    versions,
    getState: () => call<AppState>(CHANNELS.stateGet),
    patchState: (patch: StatePatch) => call<AppState>(CHANNELS.statePatch, patch),
    readFile: (path) => call(CHANNELS.fileRead, path),
    writeFile: (req) => call(CHANNELS.fileWrite, req),
    createFile: (dir, name) => call(CHANNELS.fileCreate, dir, name),
    addFiles: (paths) => call(CHANNELS.filesAdd, paths),
    revealFile: (path) => call(CHANNELS.filesReveal, path),
    copyPath: (path) => call(CHANNELS.filesCopyPath, path),
    pathForFile: (file) => {
      try {
        return deps.pathForFile(file);
      } catch {
        return "";
      }
    },
    onFilesOpened: (cb) => subscribe<FilesOpened>(CHANNELS.filesOpened, cb),
    onFlushRequest: (cb) => subscribe<void>(CHANNELS.rendererFlush, () => cb()),
    flushed: () => call(CHANNELS.rendererFlushed),
    onWatchChanged: (cb) => subscribe<WatchChanged>(CHANNELS.watchChanged, cb),
    onWatchMissing: (cb) => subscribe<WatchMissing>(CHANNELS.watchMissing, cb),
    showFileMenu: (path) => call(CHANNELS.filesContextMenu, path),
    removeFile: (path) => call<AppState>(CHANNELS.filesRemove, path),
    openFileDialog: () => call(CHANNELS.filesOpenDialog),
    onMenuAction: (cb) => subscribe<MenuAction>(CHANNELS.menuAction, cb),
    listThemes: () => call<ThemesList>(CHANNELS.themesList),
    onThemesChanged: (cb) => subscribe<Theme[]>(CHANNELS.themesChanged, cb),
    onAppearanceChanged: (cb) => subscribe<Appearance>(CHANNELS.appearanceChanged, cb),
  };

  /** Strips the IpcRendererEvent so nothing from the main side leaks into the page; returns an unsubscribe. */
  function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
    const listener = (_event: unknown, payload: unknown) => cb(payload as T);
    deps.on(channel, listener);
    return () => deps.off(channel, listener);
  }
}
