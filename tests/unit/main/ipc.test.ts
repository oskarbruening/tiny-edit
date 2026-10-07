import type { IpcMainInvokeEvent } from "electron";
import * as fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Files } from "../../../src/main/files";
import { IpcError, openPaths, registerIpc, trustedSenderFor } from "../../../src/main/ipc";
import { StateStore } from "../../../src/main/state";
import { CHANNELS } from "../../../src/shared/ipc";

let dir = "";
let store: StateStore;
const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
const shell = { showItemInFolder: vi.fn() };
const clipboard = { writeText: vi.fn() };
let trusted = true;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tiny-edit-ipc-"));
  store = new StateStore({ filePath: join(dir, "state.json"), fs, onError: () => undefined });
  store.load();
  handlers.clear();
  shell.showItemInFolder.mockClear();
  clipboard.writeText.mockClear();
  trusted = true;
  sent.length = 0;
  registerIpc({
    ipcMain: { handle: (ch, fn) => handlers.set(ch, fn) },
    store,
    files: new Files(fs),
    shell,
    clipboard,
    isTrustedSender: () => trusted,
  });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sent: { channel: string; payload: unknown }[] = [];
const event = {
  sender: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) },
} as unknown as IpcMainInvokeEvent;
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!(event, ...args);
const listed = (name: string, content = "x") => {
  const p = join(dir, name);
  fs.writeFileSync(p, content);
  store.patch({ files: [...store.get().files, { path: p, anchor: 0, head: 0, scrollTop: 0 }] });
  return p;
};

describe("registerIpc", () => {
  const pushChannels: string[] = [
    CHANNELS.filesOpened,
    CHANNELS.rendererFlush,
    CHANNELS.watchChanged,
    CHANNELS.watchMissing,
    CHANNELS.menuAction,
    CHANNELS.themesChanged,
    CHANNELS.appearanceChanged,
  ];
  const requestChannels = Object.values(CHANNELS).filter((c) => !pushChannels.includes(c));

  it("registers every request channel in the contract", () => {
    expect([...handlers.keys()].sort()).toEqual([...requestChannels].sort());
  });

  it("rejects untrusted senders on every channel", async () => {
    trusted = false;
    for (const ch of requestChannels) {
      await expect(async () => call(ch)).rejects.toThrow(IpcError);
    }
  });

  it("state:get returns the store's state", () => {
    expect(call(CHANNELS.stateGet)).toBe(store.get());
  });

  it("state:patch validates and merges", () => {
    const result = call(CHANNELS.statePatch, { fontSize: 20, sidebarWidth: 1, window: { width: 1 } }) as {
      fontSize: number;
      sidebarWidth: number;
      window: { width: number };
    };
    expect(result.fontSize).toBe(20);
    expect(result.sidebarWidth).toBe(120);
    expect(result.window.width).toBe(950);
  });

  it("state:patch with nothing valid leaves the store untouched", () => {
    const before = store.get();
    expect(call(CHANNELS.statePatch, { garbage: true })).toBe(before);
    expect(call(CHANNELS.statePatch, "not an object")).toBe(before);
    expect(store.dirty).toBe(false);
  });

  it("file:read only serves listed absolute paths", async () => {
    const p = listed("a.md", "hello");
    await expect(call(CHANNELS.fileRead, p)).resolves.toMatchObject({ text: "hello" });
    const other = join(dir, "other.md");
    fs.writeFileSync(other, "secret");
    await expect(async () => call(CHANNELS.fileRead, other)).rejects.toThrow("not in the file list");
    await expect(async () => call(CHANNELS.fileRead, "relative.md")).rejects.toThrow("must be absolute");
    await expect(async () => call(CHANNELS.fileRead, 42)).rejects.toThrow("must be absolute");
  });

  it("file:write validates the request shape and forwards the guard fields", async () => {
    const p = listed("a.md", "v1");
    const read = (await call(CHANNELS.fileRead, p)) as { stamp: { mtimeMs: number; size: number } };
    const ok = await call(CHANNELS.fileWrite, {
      path: p,
      text: "a\nb",
      eol: "\r\n",
      bom: true,
      expected: read.stamp,
    });
    expect(ok).toMatchObject({ ok: true });
    expect(fs.readFileSync(p, "utf8")).toBe("\uFEFFa\r\nb");

    const conflict = await call(CHANNELS.fileWrite, {
      path: p,
      text: "stale",
      eol: "\n",
      bom: false,
      expected: read.stamp,
    });
    expect(conflict).toMatchObject({ ok: false });
    const forced = await call(CHANNELS.fileWrite, {
      path: p,
      text: "forced",
      eol: "\n",
      bom: false,
      expected: read.stamp,
      force: true,
    });
    expect(forced).toMatchObject({ ok: true });
    expect(fs.readFileSync(p, "utf8")).toBe("forced");

    const noGuard = await call(CHANNELS.fileWrite, {
      path: p,
      text: "free",
      eol: "lf?",
      bom: "yes",
      expected: { mtimeMs: "x" },
    });
    expect(noGuard).toMatchObject({ ok: true });
    expect(fs.readFileSync(p, "utf8")).toBe("free");

    await expect(async () => call(CHANNELS.fileWrite, "nope")).rejects.toThrow("request must be an object");
    await expect(async () => call(CHANNELS.fileWrite, { path: p, text: 5 })).rejects.toThrow(
      "text must be a string",
    );
    await expect(async () => call(CHANNELS.fileWrite, { path: join(dir, "x.md"), text: "" })).rejects.toThrow(
      "not in the file list",
    );
  });

  it("file:create adds the new file to the list; failures do not", async () => {
    const r = (await call(CHANNELS.fileCreate, dir, "notes")) as { ok: boolean; path?: string };
    expect(r.ok).toBe(true);
    expect(store.get().files.map((f) => f.path)).toEqual([join(dir, "notes.md")]);
    expect(sent).toEqual([{ channel: "files:opened", payload: { paths: [join(dir, "notes.md")] } }]);
    const dup = (await call(CHANNELS.fileCreate, dir, "notes")) as { ok: boolean };
    expect(dup.ok).toBe(false);
    expect(store.get().files).toHaveLength(1);
    await expect(async () => call(CHANNELS.fileCreate, dir, 3)).rejects.toThrow("name a string");
  });

  it("files:add appends accepted paths once and reports rejections", async () => {
    const a = join(dir, "a.md");
    const b = join(dir, "b.bin");
    fs.writeFileSync(a, "a");
    fs.writeFileSync(b, new Uint8Array([0, 1]));
    const r = (await call(CHANNELS.filesAdd, [a, b, 7])) as { added: string[]; rejected: unknown[] };
    expect(r.added).toEqual([a]);
    expect(r.rejected).toEqual([{ path: b, reason: "binary" }]);
    expect(store.get().files.map((f) => f.path)).toEqual([a]);
    expect(sent).toEqual([{ channel: "files:opened", payload: { paths: [a] } }]);
    await call(CHANNELS.filesAdd, [a]);
    expect(store.get().files).toHaveLength(1);
    expect(sent).toHaveLength(2); // re-adding a listed file still tells the renderer to select it
    await call(CHANNELS.filesAdd, [b]);
    expect(sent).toHaveLength(2); // nothing accepted → no push
    await expect(async () => call(CHANNELS.filesAdd, "a")).rejects.toThrow("expected an array");
  });

  it("files:reveal and files:copyPath act only on listed paths", async () => {
    const p = listed("a.md");
    call(CHANNELS.filesReveal, p);
    call(CHANNELS.filesCopyPath, p);
    expect(shell.showItemInFolder).toHaveBeenCalledWith(p);
    expect(clipboard.writeText).toHaveBeenCalledWith(p);
    expect(() => call(CHANNELS.filesReveal, "/etc/passwd")).toThrow("not in the file list");
    expect(() => call(CHANNELS.filesCopyPath, "/etc/passwd")).toThrow("not in the file list");
  });

  it("file:read and successful file:write report the stamp the renderer now holds", async () => {
    const onFileStamp = vi.fn();
    const h = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    registerIpc({
      ipcMain: { handle: (ch, fn) => h.set(ch, fn) },
      store,
      files: new Files(fs),
      shell,
      clipboard,
      onFileStamp,
    });
    const p = listed("s.md", "v1");
    const read = (await h.get(CHANNELS.fileRead)!(event, p)) as { stamp: unknown };
    expect(onFileStamp).toHaveBeenCalledWith(p, read.stamp);
    const written = (await h.get(CHANNELS.fileWrite)!(event, {
      path: p,
      text: "v2",
      eol: "\n",
      bom: false,
    })) as { ok: boolean; stamp: unknown };
    expect(onFileStamp).toHaveBeenLastCalledWith(p, written.stamp);
    await new Promise((r) => setTimeout(r, 15));
    fs.writeFileSync(p, "elsewhere");
    await h.get(CHANNELS.fileWrite)!(event, {
      path: p,
      text: "v3",
      eol: "\n",
      bom: false,
      expected: read.stamp,
    });
    expect(onFileStamp).toHaveBeenCalledTimes(2); // conflict: nothing new to report
  });

  it("files:contextMenu shows the native menu for listed paths and relays its choice to the sender", () => {
    const showContextMenu = vi.fn();
    const h = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    registerIpc({
      ipcMain: { handle: (ch, fn) => h.set(ch, fn) },
      store,
      files: new Files(fs),
      shell,
      clipboard,
      showContextMenu,
    });
    const p = listed("a.md");
    h.get(CHANNELS.filesContextMenu)!(event, p);
    expect(showContextMenu).toHaveBeenCalledWith(p, expect.any(Function));
    (showContextMenu.mock.calls[0]![1] as (a: unknown) => void)({ type: "removeFile", path: p });
    expect(sent.at(-1)).toEqual({ channel: "menu:action", payload: { type: "removeFile", path: p } });
    expect(() => h.get(CHANNELS.filesContextMenu)!(event, "/etc/passwd")).toThrow("not in the file list");
    call(CHANNELS.filesContextMenu, p); // no hook injected: must not throw
  });

  it("files:remove drops the entry (disk untouched) and clears activePath when it was active", () => {
    const a = listed("a.md");
    const b = listed("b.md");
    store.patch({ activePath: a });
    const after = call(CHANNELS.filesRemove, a) as { files: { path: string }[]; activePath: string | null };
    expect(after.files.map((f) => f.path)).toEqual([b]);
    expect(after.activePath).toBeNull();
    expect(fs.existsSync(a)).toBe(true);
    store.patch({ activePath: b });
    expect((call(CHANNELS.filesRemove, b) as { activePath: string | null }).activePath).toBeNull();
    expect(() => call(CHANNELS.filesRemove, a)).toThrow("not in the file list");
  });

  it("files:openDialog accepts the picked paths and notifies; cancel is a no-op", async () => {
    const a = join(dir, "picked.md");
    fs.writeFileSync(a, "x");
    const pickFiles = vi.fn(async () => [a]);
    const h = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    registerIpc({
      ipcMain: { handle: (ch, fn) => h.set(ch, fn) },
      store,
      files: new Files(fs),
      shell,
      clipboard,
      pickFiles,
    });
    await h.get(CHANNELS.filesOpenDialog)!(event);
    expect(store.get().files.map((f) => f.path)).toEqual([a]);
    expect(sent.at(-1)).toEqual({ channel: "files:opened", payload: { paths: [a] } });
    pickFiles.mockResolvedValueOnce([]);
    await h.get(CHANNELS.filesOpenDialog)!(event);
    expect(sent).toHaveLength(1);
    await call(CHANNELS.filesOpenDialog); // no picker injected
    expect(sent).toHaveLength(1);
  });

  it("file:create with a null dir uses the default folder; rejects other non-strings", async () => {
    const h = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    registerIpc({
      ipcMain: { handle: (ch, fn) => h.set(ch, fn) },
      store,
      files: new Files(fs),
      shell,
      clipboard,
      defaultDir: () => dir,
    });
    const r = (await h.get(CHANNELS.fileCreate)!(event, null, "fresh")) as { ok: boolean; path?: string };
    expect(r).toEqual({ ok: true, path: join(dir, "fresh.md") });
    await expect(async () => h.get(CHANNELS.fileCreate)!(event, 5, "x")).rejects.toThrow(
      "dir must be a string or null",
    );
    const noDefault = (await call(CHANNELS.fileCreate, null, "orphan")) as { ok: boolean };
    expect(noDefault.ok).toBe(false); // "" is not absolute
  });

  it("themes:list returns the injected themes, or an empty light default", () => {
    expect(call(CHANNELS.themesList)).toEqual({ themes: [], appearance: "light" });
    const h = new Map<string, (event: IpcMainInvokeEvent) => unknown>();
    const payload = { themes: [], appearance: "dark" as const };
    registerIpc({
      ipcMain: { handle: (ch, fn) => h.set(ch, fn) },
      store,
      files: new Files(fs),
      shell,
      clipboard,
      themes: () => payload,
    });
    expect(h.get(CHANNELS.themesList)!(event)).toBe(payload);
  });

  it("renderer:flushed forwards the sender id to the flush gate hook", () => {
    const onRendererFlushed = vi.fn();
    const h = new Map<string, (event: IpcMainInvokeEvent) => unknown>();
    registerIpc({
      ipcMain: { handle: (ch, fn) => h.set(ch, fn) },
      store,
      files: new Files(fs),
      shell,
      clipboard,
      onRendererFlushed,
    });
    h.get(CHANNELS.rendererFlushed)!({ sender: { id: 42, send: vi.fn() } } as unknown as IpcMainInvokeEvent);
    expect(onRendererFlushed).toHaveBeenCalledWith(42);
    call(CHANNELS.rendererFlushed); // no hook injected in the main fixture: must not throw
  });

  it("defaults to trusting every sender when no checker is injected", () => {
    const h = new Map<string, (event: IpcMainInvokeEvent) => unknown>();
    registerIpc({
      ipcMain: { handle: (ch, fn) => h.set(ch, fn) },
      store,
      files: new Files(fs),
      shell,
      clipboard,
    });
    expect(h.get(CHANNELS.stateGet)!(event)).toBe(store.get());
  });
});

describe("trustedSenderFor", () => {
  const check = trustedSenderFor(["app://renderer", "http://localhost:5173"]);
  const ev = (url: string | undefined) =>
    ({ senderFrame: url === undefined ? null : { url } }) as unknown as IpcMainInvokeEvent;
  it("accepts our renderer origins only", () => {
    expect(check(ev("app://renderer/index.html"))).toBe(true);
    expect(check(ev("file:///Users/x/out/renderer/index.html"))).toBe(false);
    expect(check(ev("http://localhost:5173/"))).toBe(true);
    expect(check(ev("https://evil.example/"))).toBe(false);
    expect(check(ev(""))).toBe(false);
    expect(check(ev(undefined))).toBe(false);
  });
});

describe("openPaths", () => {
  it("accepts, appends new paths only, and always notifies for accepted ones", async () => {
    const d = await mkdtemp(join(tmpdir(), "tiny-edit-open-"));
    try {
      const a = join(d, "a.md");
      fs.writeFileSync(a, "a");
      const st = new StateStore({ filePath: join(d, "state.json"), fs, onError: () => undefined });
      st.load();
      const send = vi.fn();
      await openPaths([a, join(d, "nope.png")], { files: new Files(fs), store: st, send });
      expect(st.get().files.map((f) => f.path)).toEqual([a]);
      expect(send).toHaveBeenCalledWith("files:opened", { paths: [a] });
      await openPaths([a], { files: new Files(fs), store: st, send });
      expect(st.get().files).toHaveLength(1);
      expect(send).toHaveBeenCalledTimes(2);
      await openPaths([join(d, "missing.md")], { files: new Files(fs), store: st, send });
      expect(send).toHaveBeenCalledTimes(2);
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });
});
