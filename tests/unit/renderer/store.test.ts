import { describe, expect, it, vi } from "vitest";
import { Store } from "../../../src/renderer/store";
import { defaultState, type AppState } from "../../../src/shared/state";

const withFiles = (): AppState => ({
  ...defaultState(),
  files: [
    { path: "/a.md", anchor: 0, head: 0, scrollTop: 0 },
    { path: "/b.md", anchor: 5, head: 5, scrollTop: 10 },
  ],
  activePath: "/a.md",
});

describe("Store", () => {
  it("applies patches locally, notifies, and persists", async () => {
    const persist = vi.fn(async (p) => ({ ...withFiles(), ...p }));
    const store = new Store(withFiles(), persist);
    const seen: number[] = [];
    const off = store.subscribe((s) => seen.push(s.fontSize));
    store.patch({ fontSize: 20 });
    expect(store.get().fontSize).toBe(20);
    expect(persist).toHaveBeenCalledWith({ fontSize: 20 });
    off();
    store.patch({ fontSize: 21 });
    expect(seen).toEqual([20]);
  });

  it("reports persistence failures through onError", async () => {
    const onError = vi.fn();
    const store = new Store(
      withFiles(),
      async () => {
        throw new Error("ipc down");
      },
      onError,
    );
    store.patch({ fontSize: 20 });
    await vi.waitFor(() =>
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "ipc down" })),
    );
  });

  it("logs to console.error by default", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const store = new Store(withFiles(), async () => {
      throw new Error("x");
    });
    store.patch({ fontSize: 20 });
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    spy.mockRestore();
  });

  it("setFileView updates only the matching file and skips no-ops and unknown paths", () => {
    const persist = vi.fn(async (p) => ({ ...withFiles(), ...p }));
    const store = new Store(withFiles(), persist);
    store.setFileView("/b.md", { anchor: 5, head: 5, scrollTop: 10 });
    store.setFileView("/zzz.md", { anchor: 1, head: 1, scrollTop: 1 });
    expect(persist).not.toHaveBeenCalled();
    store.setFileView("/a.md", { anchor: 3, head: 4, scrollTop: 100 });
    expect(store.fileState("/a.md")).toEqual({ path: "/a.md", anchor: 3, head: 4, scrollTop: 100 });
    expect(store.fileState("/b.md")).toEqual({ path: "/b.md", anchor: 5, head: 5, scrollTop: 10 });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("setActive persists only on change; replace swaps the whole state", () => {
    const persist = vi.fn(async (p) => ({ ...withFiles(), ...p }));
    const store = new Store(withFiles(), persist);
    store.setActive("/a.md");
    expect(persist).not.toHaveBeenCalled();
    store.setActive("/b.md");
    expect(persist).toHaveBeenCalledWith({ activePath: "/b.md" });
    const fresh = { ...defaultState(), fontSize: 9 };
    const listener = vi.fn();
    store.subscribe(listener);
    store.replace(fresh);
    expect(store.get()).toBe(fresh);
    expect(listener).toHaveBeenCalledWith(fresh);
  });
});
