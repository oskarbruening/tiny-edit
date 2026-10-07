import { describe, expect, it, vi } from "vitest";
import { createApi } from "../../../src/preload/api";
import { API_KEYS } from "../../../src/shared/ipc";

const versions = { electron: "44.6.0", chrome: "152.0", node: "24.18.1" };
const deps = () => ({
  versions,
  invoke: vi.fn(async (channel: string, ...args: unknown[]) => ({ channel, args })),
  pathForFile: vi.fn(() => "/p"),
  on: vi.fn(),
  off: vi.fn(),
});

describe("createApi", () => {
  it("exposes exactly the contract surface", () => {
    const api = createApi(deps());
    expect(api.versions).toEqual(versions);
    expect(Object.keys(api).sort()).toEqual([...API_KEYS].sort());
  });

  it("fills missing versions with empty strings", () => {
    expect(createApi({ ...deps(), versions: {} }).versions).toEqual({ electron: "", chrome: "", node: "" });
  });

  it("routes every method through invoke with its channel and arguments", async () => {
    const d = deps();
    const api = createApi(d);
    const req = { path: "/a.md", text: "t", eol: "\n" as const, bom: false };
    await expect(api.getState()).resolves.toEqual({ channel: "state:get", args: [] });
    await expect(api.patchState({ fontSize: 16 })).resolves.toEqual({
      channel: "state:patch",
      args: [{ fontSize: 16 }],
    });
    await expect(api.readFile("/a.md")).resolves.toEqual({ channel: "file:read", args: ["/a.md"] });
    await expect(api.writeFile(req)).resolves.toEqual({ channel: "file:write", args: [req] });
    await expect(api.createFile("/d", "n")).resolves.toEqual({ channel: "file:create", args: ["/d", "n"] });
    await expect(api.addFiles(["/a.md"])).resolves.toEqual({ channel: "files:add", args: [["/a.md"]] });
    await expect(api.revealFile("/a.md")).resolves.toEqual({ channel: "files:reveal", args: ["/a.md"] });
    await expect(api.copyPath("/a.md")).resolves.toEqual({ channel: "files:copyPath", args: ["/a.md"] });
    await expect(api.flushed()).resolves.toEqual({ channel: "renderer:flushed", args: [] });
    await expect(api.showFileMenu("/a.md")).resolves.toEqual({
      channel: "files:contextMenu",
      args: ["/a.md"],
    });
    await expect(api.removeFile("/a.md")).resolves.toEqual({ channel: "files:remove", args: ["/a.md"] });
    await expect(api.openFileDialog()).resolves.toEqual({ channel: "files:openDialog", args: [] });
    await expect(api.createFile(null, "n")).resolves.toEqual({ channel: "file:create", args: [null, "n"] });
    await expect(api.listThemes()).resolves.toEqual({ channel: "themes:list", args: [] });
  });

  it("pathForFile returns the path and swallows webUtils errors as empty string", () => {
    const d = deps();
    const api = createApi(d);
    const file = {} as File;
    expect(api.pathForFile(file)).toBe("/p");
    expect(d.pathForFile).toHaveBeenCalledWith(file);
    d.pathForFile.mockImplementation(() => {
      throw new TypeError("not a File");
    });
    expect(api.pathForFile(file)).toBe("");
  });

  it("onFilesOpened subscribes, strips the event, and unsubscribes", () => {
    const d = deps();
    const api = createApi(d);
    const cb = vi.fn();
    const off = api.onFilesOpened(cb);
    expect(d.on).toHaveBeenCalledWith("files:opened", expect.any(Function));
    const listener = d.on.mock.calls[0]![1] as (event: unknown, payload: unknown) => void;
    listener({ sender: "secret" }, { paths: ["/a.md"] });
    expect(cb).toHaveBeenCalledWith({ paths: ["/a.md"] });
    off();
    expect(d.off).toHaveBeenCalledWith("files:opened", listener);
  });

  it("onFlushRequest subscribes without leaking the event payload", () => {
    const d = deps();
    const api = createApi(d);
    const cb = vi.fn();
    const off = api.onFlushRequest(cb);
    const listener = d.on.mock.calls.find((c) => c[0] === "renderer:flush")![1] as (
      e: unknown,
      p: unknown,
    ) => void;
    listener({ sender: "secret" }, undefined);
    expect(cb).toHaveBeenCalledWith();
    off();
    expect(d.off).toHaveBeenCalledWith("renderer:flush", listener);
  });

  it("onWatchChanged / onWatchMissing subscribe to their channels", () => {
    const d = deps();
    const api = createApi(d);
    const changed = vi.fn();
    const missing = vi.fn();
    api.onWatchChanged(changed);
    api.onWatchMissing(missing);
    api.onMenuAction(vi.fn());
    api.onThemesChanged(vi.fn());
    api.onAppearanceChanged(vi.fn());
    const channels = d.on.mock.calls.map((c) => c[0]);
    expect(channels).toEqual(
      expect.arrayContaining([
        "watch:changed",
        "watch:missing",
        "menu:action",
        "themes:changed",
        "appearance:changed",
      ]),
    );
    const l = d.on.mock.calls.find((c) => c[0] === "watch:missing")![1] as (e: unknown, p: unknown) => void;
    l({}, { path: "/a.md" });
    expect(missing).toHaveBeenCalledWith({ path: "/a.md" });
  });
});
