import * as fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StateStore } from "../../../src/main/state";
import { defaultState } from "../../../src/shared/state";

let dir = "";
let file = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "tiny-edit-state-"));
  file = join(dir, "state.json");
});
afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

const silent = () => undefined;

describe("StateStore.load", () => {
  it("returns defaults when the file is missing and does not create it", () => {
    const store = new StateStore({ filePath: file, fs });
    expect(store.load()).toEqual(defaultState());
    expect(fs.existsSync(file)).toBe(false);
    expect(store.dirty).toBe(false);
  });

  it("parses an existing file", () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ sidebarWidth: 300, files: [{ path: "/a.md" }], activePath: "/a.md" }),
    );
    const store = new StateStore({ filePath: file, fs });
    const s = store.load();
    expect(s.sidebarWidth).toBe(300);
    expect(s.activePath).toBe("/a.md");
    expect(store.get()).toBe(s);
  });

  it("renames a corrupt file aside and falls back to defaults", () => {
    fs.writeFileSync(file, "{ not json");
    const onError = vi.fn();
    const now = () => new Date("2026-10-07T12:34:56.789Z");
    const store = new StateStore({ filePath: file, fs, onError, now });
    expect(store.load()).toEqual(defaultState());
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readdirSync(dir)).toEqual(["state.json.corrupt-2026-10-07T12-34-56-789Z"]);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("reports but survives a failed rename of the corrupt file", () => {
    fs.writeFileSync(file, "nope");
    const onError = vi.fn();
    const broken = {
      ...fs,
      renameSync: () => {
        throw new Error("EPERM");
      },
    };
    const store = new StateStore({ filePath: file, fs: broken as never, onError });
    expect(store.load()).toEqual(defaultState());
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("logs to console.error by default", () => {
    fs.writeFileSync(file, "nope");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    new StateStore({ filePath: file, fs }).load();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("StateStore.patch / flush", () => {
  it("debounces writes and writes once after the delay", async () => {
    const store = new StateStore({ filePath: file, fs, debounceMs: 40, onError: silent });
    store.load();
    store.patch({ sidebarWidth: 210 });
    store.patch({ sidebarWidth: 220 });
    expect(store.dirty).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(fs.existsSync(file)).toBe(false);
    await vi.waitFor(() => expect(fs.existsSync(file)).toBe(true));
    await vi.waitFor(() => expect(store.dirty).toBe(false));
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(onDisk.sidebarWidth).toBe(220);
    expect(onDisk.version).toBe(1);
    expect(fs.readdirSync(dir)).toEqual(["state.json"]);
  });

  it("flush writes synchronously, cancels the pending timer, and is a no-op when clean", () => {
    vi.useFakeTimers();
    const store = new StateStore({ filePath: file, fs, onError: silent });
    store.load();
    store.patch({ fontSize: 18 });
    store.flush();
    expect(JSON.parse(fs.readFileSync(file, "utf8")).fontSize).toBe(18);
    const mtime = fs.statSync(file).mtimeMs;
    vi.advanceTimersByTime(1000);
    store.flush();
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
    expect(store.dirty).toBe(false);
  });

  it("does not rewrite when the serialized state is unchanged", async () => {
    const store = new StateStore({ filePath: file, fs, onError: silent, debounceMs: 5 });
    store.load();
    store.patch({ fontSize: 18 });
    store.flush();
    const mtime = fs.statSync(file).mtimeMs;
    store.patch({ fontSize: 18 });
    await vi.waitFor(() => expect(store.dirty).toBe(false));
    await new Promise((r) => setTimeout(r, 20));
    expect(fs.statSync(file).mtimeMs).toBe(mtime);
  });

  it("never lets a patch change the version", () => {
    const store = new StateStore({ filePath: file, fs, onError: silent });
    store.load();
    expect(store.patch({ version: 7 } as never).version).toBe(1);
  });

  it("reports write errors instead of throwing (async and sync)", async () => {
    const onError = vi.fn();
    const broken = {
      ...fs,
      writeFileSync: () => {
        throw new Error("sync boom");
      },
      promises: {
        ...fs.promises,
        writeFile: async () => {
          throw new Error("async boom");
        },
      },
    };
    const store = new StateStore({ filePath: file, fs: broken as never, onError, debounceMs: 5 });
    store.load();
    store.patch({ fontSize: 20 });
    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "async boom" })),
    );
    store.flush();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "sync boom" }));
  });

  it("notifies subscribers after every patch, not on load", () => {
    const store = new StateStore({ filePath: file, fs, onError: silent });
    const seen: number[] = [];
    const off = store.subscribe((s) => seen.push(s.fontSize));
    store.load();
    store.patch({ fontSize: 15 });
    store.patch({ fontSize: 16 });
    off();
    store.patch({ fontSize: 17 });
    expect(seen).toEqual([15, 16]);
  });
});
