import type { IpcMainInvokeEvent } from "electron";
import { isAbsolute } from "node:path";
import { CHANNELS, type Channel, type MenuAction, type ThemesList } from "../shared/ipc";
import { parsePatch, type AppState } from "../shared/state";
import { formatOf } from "../shared/text";
import { formatText } from "./format";
import { forgetOpened, rememberClosed } from "./recent";
import type { Files, Rejection, WriteRequest } from "./files";
import type { StateStore } from "./state";

export type IpcMainLike = {
  handle(channel: Channel, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void;
};

export type IpcDeps = {
  ipcMain: IpcMainLike;
  store: StateStore;
  files: Files;
  shell: { showItemInFolder(path: string): void; openExternal(url: string): Promise<unknown> };
  clipboard: { writeText(text: string): void };
  /** Only our own renderer may call. Default accepts everything (unit tests inject a checker). */
  isTrustedSender?: (event: IpcMainInvokeEvent) => boolean;
  /** Receives renderer:flushed acks with the paths still unsaved (see FlushGate). */
  onRendererFlushed?: (senderId: number, pending: string[]) => void;
  /** Paths a drop / Open… refused; main shows the "couldn't open" dialog. */
  onRejected?: (rejected: Rejection[]) => void;
  /** Pretty Format failed (the file could not be parsed); main shows the warning dialog. */
  onFormatFailed?: (detail: string) => void;
  /** The stamp the renderer now holds for a file (after read/write); the watcher ignores it. */
  onFileStamp?: (path: string, stamp: { mtimeMs: number; size: number }) => void;
  /** Shows the native context menu for a listed file (Menu.buildFromTemplate + popup). */
  showContextMenu?: (path: string, send: (action: MenuAction) => void) => void;
  /** Shows the Open… dialog and resolves to the chosen paths ([] when cancelled). */
  pickFiles?: () => Promise<string[]>;
  /** Fallback folder for Cmd+N when the list is empty (app.getPath("documents")). */
  defaultDir?: () => string;
  /** Built-in + user themes and the OS appearance. */
  themes?: () => ThemesList;
};

export class IpcError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Registers every request channel once. Each handler validates its arguments. */
export function registerIpc(deps: IpcDeps): void {
  const { ipcMain, store, files, shell, clipboard } = deps;
  const trusted = deps.isTrustedSender ?? (() => true);

  const guard = <T>(
    channel: Channel,
    fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => T | Promise<T>,
  ) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!trusted(event)) throw new IpcError(`${channel}: untrusted sender`);
      return fn(event, ...args);
    });

  /** A path the renderer may read/write/reveal: a string that is already in the file list. */
  const listedPath = (raw: unknown, channel: Channel): string => {
    if (typeof raw !== "string" || !isAbsolute(raw)) throw new IpcError(`${channel}: path must be absolute`);
    if (!store.get().files.some((f) => f.path === raw))
      throw new IpcError(`${channel}: path is not in the file list`);
    return raw;
  };

  /** Appends new paths to the list and tells the renderer which paths were opened (new or already listed). */
  const appendFiles = (event: IpcMainInvokeEvent, paths: string[]): void => {
    const s = store.get();
    const known = new Set(s.files.map((f) => f.path));
    const fresh = paths
      .filter((p) => !known.has(p))
      .map((path) => ({ path, anchor: 0, head: 0, scrollTop: 0 }));
    const recentlyClosed = forgetOpened(s.recentlyClosed, paths); // opened → no longer "recently closed"
    const patch: Partial<AppState> = {};
    if (fresh.length) patch.files = [...s.files, ...fresh];
    if (recentlyClosed.length !== s.recentlyClosed.length) patch.recentlyClosed = recentlyClosed;
    if (Object.keys(patch).length) store.patch(patch);
    if (paths.length) event.sender.send(CHANNELS.filesOpened, { paths });
  };

  guard(CHANNELS.stateGet, (): AppState => store.get());

  guard(CHANNELS.statePatch, (_event, raw): AppState => {
    const patch = parsePatch(raw, store.get());
    return Object.keys(patch).length > 0 ? store.patch(patch) : store.get();
  });

  guard(CHANNELS.fileRead, async (_event, raw) => {
    const path = listedPath(raw, CHANNELS.fileRead);
    const result = await files.read(path);
    deps.onFileStamp?.(path, result.stamp);
    return result;
  });

  guard(CHANNELS.fileWrite, async (_event, raw) => {
    if (!isRecord(raw)) throw new IpcError("file:write: request must be an object");
    const path = listedPath(raw["path"], CHANNELS.fileWrite);
    if (typeof raw["text"] !== "string") throw new IpcError("file:write: text must be a string");
    const eol = raw["eol"] === "\r\n" ? "\r\n" : "\n";
    const exp = raw["expected"];
    const expected =
      isRecord(exp) && typeof exp["mtimeMs"] === "number" && typeof exp["size"] === "number"
        ? { mtimeMs: exp["mtimeMs"], size: exp["size"] }
        : null;
    const req: WriteRequest = {
      path,
      text: raw["text"],
      eol,
      bom: raw["bom"] === true,
      expected,
      force: raw["force"] === true,
    };
    const result = await files.write(req);
    if (result.ok) deps.onFileStamp?.(path, result.stamp);
    return result;
  });

  guard(CHANNELS.fileCreate, async (event, dir, name) => {
    if ((typeof dir !== "string" && dir !== null) || typeof name !== "string")
      throw new IpcError("file:create: dir must be a string or null and name a string");
    const folder = dir ?? deps.defaultDir?.() ?? "";
    const result = await files.create(folder, name);
    if (result.ok) appendFiles(event, [result.path]);
    return result;
  });

  guard(CHANNELS.filesAdd, async (event, raw) => {
    if (!Array.isArray(raw) || raw.length > 10_000)
      throw new IpcError("files:add: expected an array of paths");
    const result = await files.accept(raw.filter((p): p is string => typeof p === "string"));
    appendFiles(event, result.added);
    if (result.rejected.length) deps.onRejected?.(result.rejected);
    return result;
  });

  guard(CHANNELS.filesReveal, (_event, raw) => {
    shell.showItemInFolder(listedPath(raw, CHANNELS.filesReveal));
  });

  guard(CHANNELS.filesCopyPath, (_event, raw) => {
    clipboard.writeText(listedPath(raw, CHANNELS.filesCopyPath));
  });

  guard(CHANNELS.clipboardWrite, (_event, raw) => {
    if (typeof raw !== "string") throw new IpcError("clipboard:write: text must be a string");
    clipboard.writeText(raw);
  });

  guard(CHANNELS.shellOpenExternal, (_event, raw) => {
    if (typeof raw !== "string") throw new IpcError("shell:openExternal: url must be a string");
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      throw new IpcError("shell:openExternal: invalid url");
    }
    if (!["https:", "http:", "mailto:"].includes(parsed.protocol))
      throw new IpcError("shell:openExternal: unsupported protocol");
    void shell.openExternal(raw);
  });

  guard(CHANNELS.formatRun, async (_event, raw) => {
    if (!isRecord(raw)) throw new IpcError("format:run: request must be an object");
    const path = listedPath(raw["path"], CHANNELS.formatRun);
    if (typeof raw["text"] !== "string") throw new IpcError("format:run: text must be a string");
    const format = formatOf(path);
    if (!format) throw new IpcError("format:run: this file type cannot be formatted");
    const result = await formatText(format, raw["text"]);
    if (!result.ok) deps.onFormatFailed?.(result.error);
    return result;
  });

  guard(CHANNELS.rendererFlushed, (event, raw) => {
    const list = isRecord(raw) && Array.isArray(raw["pending"]) ? raw["pending"] : [];
    const pending = list.filter((p): p is string => typeof p === "string");
    deps.onRendererFlushed?.(event.sender.id, pending);
  });

  guard(CHANNELS.filesContextMenu, (event, raw) => {
    const path = listedPath(raw, CHANNELS.filesContextMenu);
    deps.showContextMenu?.(path, (action) => event.sender.send(CHANNELS.menuAction, action));
  });

  guard(CHANNELS.filesRemove, (_event, raw): AppState => {
    const path = listedPath(raw, CHANNELS.filesRemove);
    const s = store.get();
    const files = s.files.filter((f) => f.path !== path);
    return store.patch({
      files,
      activePath: s.activePath === path ? null : s.activePath,
      recentlyClosed: rememberClosed(s.recentlyClosed, path), // closed → remember for File → Recently Closed
    });
  });

  guard(CHANNELS.themesList, (): ThemesList => deps.themes?.() ?? { themes: [], appearance: "light" });

  guard(CHANNELS.filesOpenDialog, async (event) => {
    const picked = (await deps.pickFiles?.()) ?? [];
    if (picked.length === 0) return;
    const result = await files.accept(picked);
    appendFiles(event, result.added);
    if (result.rejected.length) deps.onRejected?.(result.rejected);
  });
}

/** Shared by Open…, Finder/Dock opens, the Recently Closed menu, and drops that bypass the renderer. */
export async function openPaths(
  paths: readonly string[],
  deps: {
    files: Files;
    store: StateStore;
    send: (channel: string, payload: unknown) => void;
    onRejected?: (rejected: Rejection[]) => void;
  },
): Promise<void> {
  const result = await deps.files.accept(paths);
  if (result.rejected.length) deps.onRejected?.(result.rejected);
  const s = deps.store.get();
  // Opened paths leave the Recently Closed list; so do rejected ones (a dead entry clicked in the
  // menu can't be reopened, so drop it instead of letting it linger).
  const touched = [...result.added, ...result.rejected.map((r) => r.path)];
  const recentlyClosed = forgetOpened(s.recentlyClosed, touched);
  const known = new Set(s.files.map((f) => f.path));
  const fresh = result.added
    .filter((p) => !known.has(p))
    .map((path) => ({ path, anchor: 0, head: 0, scrollTop: 0 }));
  const patch: Partial<AppState> = {};
  if (fresh.length) patch.files = [...s.files, ...fresh];
  if (recentlyClosed.length !== s.recentlyClosed.length) patch.recentlyClosed = recentlyClosed;
  if (Object.keys(patch).length) deps.store.patch(patch);
  if (result.added.length) deps.send(CHANNELS.filesOpened, { paths: result.added });
}

/** Sender check used in production: the frame must be our renderer (file:// build or the dev server). */
export function trustedSenderFor(allowedOrigins: readonly string[]) {
  return (event: IpcMainInvokeEvent): boolean => {
    const url = event.senderFrame?.url;
    if (!url) return false;
    return allowedOrigins.some((origin) => url.startsWith(origin));
  };
}
