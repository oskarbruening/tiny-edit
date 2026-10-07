import type { IpcMainInvokeEvent } from "electron";
import { isAbsolute } from "node:path";
import { CHANNELS, type Channel, type MenuAction, type ThemesList } from "../shared/ipc";
import { parsePatch, type AppState } from "../shared/state";
import type { Files, WriteRequest } from "./files";
import type { StateStore } from "./state";

export type IpcMainLike = {
  handle(channel: Channel, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void;
};

export type IpcDeps = {
  ipcMain: IpcMainLike;
  store: StateStore;
  files: Files;
  shell: { showItemInFolder(path: string): void };
  clipboard: { writeText(text: string): void };
  /** Only our own renderer may call. Default accepts everything (unit tests inject a checker). */
  isTrustedSender?: (event: IpcMainInvokeEvent) => boolean;
  /** Receives renderer:flushed acks (see FlushGate). */
  onRendererFlushed?: (senderId: number) => void;
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
    const current = store.get().files;
    const known = new Set(current.map((f) => f.path));
    const fresh = paths
      .filter((p) => !known.has(p))
      .map((path) => ({ path, anchor: 0, head: 0, scrollTop: 0 }));
    if (fresh.length) store.patch({ files: [...current, ...fresh] });
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
    return result;
  });

  guard(CHANNELS.filesReveal, (_event, raw) => {
    shell.showItemInFolder(listedPath(raw, CHANNELS.filesReveal));
  });

  guard(CHANNELS.filesCopyPath, (_event, raw) => {
    clipboard.writeText(listedPath(raw, CHANNELS.filesCopyPath));
  });

  guard(CHANNELS.rendererFlushed, (event) => {
    deps.onRendererFlushed?.(event.sender.id);
  });

  guard(CHANNELS.filesContextMenu, (event, raw) => {
    const path = listedPath(raw, CHANNELS.filesContextMenu);
    deps.showContextMenu?.(path, (action) => event.sender.send(CHANNELS.menuAction, action));
  });

  guard(CHANNELS.filesRemove, (_event, raw): AppState => {
    const path = listedPath(raw, CHANNELS.filesRemove);
    const s = store.get();
    const files = s.files.filter((f) => f.path !== path);
    return store.patch({ files, activePath: s.activePath === path ? null : s.activePath });
  });

  guard(CHANNELS.themesList, (): ThemesList => deps.themes?.() ?? { themes: [], appearance: "light" });

  guard(CHANNELS.filesOpenDialog, async (event) => {
    const picked = (await deps.pickFiles?.()) ?? [];
    if (picked.length === 0) return;
    const result = await files.accept(picked);
    appendFiles(event, result.added);
  });
}

/** Shared by Open…, Finder/Dock opens and drops that bypass the renderer: accept, append, notify. */
export async function openPaths(
  paths: readonly string[],
  deps: { files: Files; store: StateStore; send: (channel: string, payload: unknown) => void },
): Promise<void> {
  const result = await deps.files.accept(paths);
  if (result.added.length === 0) return;
  const current = deps.store.get().files;
  const known = new Set(current.map((f) => f.path));
  const fresh = result.added
    .filter((p) => !known.has(p))
    .map((path) => ({ path, anchor: 0, head: 0, scrollTop: 0 }));
  if (fresh.length) deps.store.patch({ files: [...current, ...fresh] });
  deps.send(CHANNELS.filesOpened, { paths: result.added });
}

/** Sender check used in production: the frame must be our renderer (file:// build or the dev server). */
export function trustedSenderFor(allowedOrigins: readonly string[]) {
  return (event: IpcMainInvokeEvent): boolean => {
    const url = event.senderFrame?.url;
    if (!url) return false;
    return allowedOrigins.some((origin) => url.startsWith(origin));
  };
}
