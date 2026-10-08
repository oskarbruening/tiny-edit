/**
 * The single IPC contract. Channel names are `domain:verb`. The preload implements
 * `Api`; main registers a handler for every request channel in `registerIpc()`.
 * Adding a channel touches this file, the preload, the main handler, docs/architecture.md and tests.
 */
import type { AppState, StatePatch } from "./state";
import type { Eol } from "./text";
import type { Appearance, Theme } from "./themes";

export const CHANNELS = {
  stateGet: "state:get",
  statePatch: "state:patch",
  fileRead: "file:read",
  fileWrite: "file:write",
  fileCreate: "file:create",
  filesAdd: "files:add",
  filesReveal: "files:reveal",
  filesCopyPath: "files:copyPath",
  /** R→M: write arbitrary text to the system clipboard (editor copy buttons). */
  clipboardWrite: "clipboard:write",
  /** R→M: open an http(s)/mailto URL in the default browser (editor link icons / Cmd+click). */
  shellOpenExternal: "shell:openExternal",
  /** M→R: files were added to the list (drop, Cmd+N, Finder open). */
  filesOpened: "files:opened",
  /** M→R: the window is closing; save everything, then answer with renderer:flushed { pending }. */
  rendererFlush: "renderer:flush",
  rendererFlushed: "renderer:flushed",
  /** M→R: a listed file changed on disk (not by us) / disappeared. */
  watchChanged: "watch:changed",
  watchMissing: "watch:missing",
  /** R→M: show the native context menu for a listed file. */
  filesContextMenu: "files:contextMenu",
  /** R→M: remove a file from the list (never from disk). */
  filesRemove: "files:remove",
  /** R→M: show the Open… dialog; accepted picks arrive via files:opened. */
  filesOpenDialog: "files:openDialog",
  /** M→R: an application-menu or context-menu command for the renderer to perform. */
  menuAction: "menu:action",
  /** R→M: built-in + user themes and the current OS appearance. */
  themesList: "themes:list",
  /** M→R: the user theme folder changed. */
  themesChanged: "themes:changed",
  /** M→R: macOS switched between light and dark. */
  appearanceChanged: "appearance:changed",
} as const;

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

export type Versions = { electron: string; chrome: string; node: string };

export type FileStamp = { mtimeMs: number; size: number };
/** `readOnly`: the bytes are not valid UTF-8; `text` is a lossy rendering that must never be written back. */
export type ReadFileResult = {
  text: string;
  eol: Eol;
  bom: boolean;
  stamp: FileStamp;
  large: boolean;
  readOnly: boolean;
};
export type WriteFileRequest = {
  path: string;
  text: string;
  eol: Eol;
  bom: boolean;
  expected?: FileStamp | null;
  force?: boolean;
};
export type WriteFileResult = { ok: true; stamp: FileStamp } | { ok: false; conflict: FileStamp };
export type AddFilesResult = { added: string[]; rejected: { path: string; reason: string }[] };
export type CreateFileResult = { ok: true; path: string } | { ok: false; error: string };

export type Api = {
  /** Runtime versions, read synchronously from process.versions in the preload. */
  versions: Versions;
  /** Full persisted state as main knows it. */
  getState(): Promise<AppState>;
  /** Validated merge; resolves to the resulting full state. Unknown/invalid keys are ignored. */
  patchState(patch: StatePatch): Promise<AppState>;
  /** Reads a listed file (BOM stripped, CRLF normalised). Rejects for paths not in the list. */
  readFile(path: string): Promise<ReadFileResult>;
  /** Atomic write with the mtime/size guard; conflict instead of overwrite unless `force`. */
  writeFile(req: WriteFileRequest): Promise<WriteFileResult>;
  /** Creates an empty file (`.md` appended when no extension) and adds it to the list. `dir` null → Documents. */
  createFile(dir: string | null, name: string): Promise<CreateFileResult>;
  /** Validates dropped/opened paths, appends the accepted ones to the list, returns both sets. Main shows a dialog for refused paths. */
  addFiles(paths: string[]): Promise<AddFilesResult>;
  revealFile(path: string): Promise<void>;
  copyPath(path: string): Promise<void>;
  /** Writes arbitrary text to the clipboard (inline-code / code-block copy buttons). */
  copyText(text: string): Promise<void>;
  /** Opens an allow-listed URL (http/https/mailto) in the default browser; rejects anything else. */
  openExternal(url: string): Promise<void>;
  /** Native context menu for a listed file; its choices come back as menu actions. */
  showFileMenu(path: string): Promise<void>;
  /** Removes a file from the list (disk untouched); resolves to the new state. */
  removeFile(path: string): Promise<AppState>;
  /** macOS Open… dialog. */
  openFileDialog(): Promise<void>;
  /** Absolute path of a dropped File (webUtils.getPathForFile); "" for non-disk files. */
  pathForFile(file: File): string;
  /** Main added files to the list. Returns an unsubscribe function. */
  onFilesOpened(cb: (payload: FilesOpened) => void): () => void;
  /** Main is about to close the window and wants pending saves written. */
  onFlushRequest(cb: () => void): () => void;
  /** Answer to onFlushRequest once every save that can be written has been; `pending` lists files still unsaved. */
  flushed(pending: string[]): Promise<void>;
  /** A listed file changed on disk by something other than us. */
  onWatchChanged(cb: (payload: WatchChanged) => void): () => void;
  /** A listed file is no longer on disk. */
  onWatchMissing(cb: (payload: WatchMissing) => void): () => void;
  /** Application/context menu commands. */
  onMenuAction(cb: (action: MenuAction) => void): () => void;
  listThemes(): Promise<ThemesList>;
  onThemesChanged(cb: (themes: Theme[]) => void): () => void;
  onAppearanceChanged(cb: (appearance: Appearance) => void): () => void;
};

export type ThemesList = { themes: Theme[]; appearance: Appearance };

export type MenuAction =
  | { type: "newFile" }
  | { type: "closeFile" }
  | { type: "removeFile"; path: string }
  | { type: "find" }
  | { type: "replace" }
  | { type: "toggleSidebar" }
  | { type: "openSettings" }
  | { type: "showWhatsNew" }
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "zoomReset" }
  | { type: "setThemeMode"; mode: "auto" }
  | { type: "setTheme"; id: string }
  | { type: "setAutoTheme"; appearance: Appearance; id: string };

export type WatchChanged = { path: string; stamp: FileStamp };
export type WatchMissing = { path: string };

export type FilesOpened = { paths: string[] };

/** Runtime list of the Api's keys, so tests can assert the exposed surface matches the contract exactly. */
export const API_KEYS = [
  "versions",
  "getState",
  "patchState",
  "readFile",
  "writeFile",
  "createFile",
  "addFiles",
  "revealFile",
  "copyPath",
  "copyText",
  "openExternal",
  "pathForFile",
  "onFilesOpened",
  "onFlushRequest",
  "flushed",
  "onWatchChanged",
  "onWatchMissing",
  "showFileMenu",
  "removeFile",
  "openFileDialog",
  "onMenuAction",
  "listThemes",
  "onThemesChanged",
  "onAppearanceChanged",
] as const satisfies readonly (keyof Api)[];

// Compile-time guard: every Api key must be listed above.
type MissingApiKeys = Exclude<keyof Api, (typeof API_KEYS)[number]>;
const _apiKeysComplete: MissingApiKeys extends never ? true : never = true;
void _apiKeysComplete;
