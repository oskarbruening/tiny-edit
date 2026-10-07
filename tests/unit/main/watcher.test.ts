import * as fs from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Files } from "../../../src/main/files";
import { Watcher, type WatchFn } from "../../../src/main/watcher";

type Listener = (type: string, filename: string | Buffer | null) => void;

/** A fs.watch stand-in the test drives by hand. */
function fakeWatch() {
  const dirs = new Map<string, Listener>();
  const closed: string[] = [];
  const watch: WatchFn = (dir, listener) => {
    dirs.set(dir, listener);
    return {
      close: () => {
        closed.push(dir);
        dirs.delete(dir);
      },
    };
  };
  return { watch, dirs, closed, fire: (dir: string, name: string | null) => dirs.get(dir)!("change", name) };
}

const stamp = (n: number) => ({ mtimeMs: n, size: n });

function make(stats: Map<string, ReturnType<typeof stamp> | null>, debounceMs = 50) {
  const w = fakeWatch();
  const onChanged = vi.fn();
  const onMissing = vi.fn();
  const onError = vi.fn();
  const watcher = new Watcher({
    watch: w.watch,
    stat: async (p) => stats.get(p) ?? null,
    onChanged,
    onMissing,
    onError,
    debounceMs,
  });
  return { ...w, watcher, onChanged, onMissing, onError, stats };
}

afterEach(() => vi.useRealTimers());

describe("Watcher", () => {
  it("watches one directory per distinct parent and closes directories no longer needed", () => {
    const t = make(new Map());
    t.watcher.setPaths(["/d1/a.md", "/d1/b.md", "/d2/c.md"]);
    expect([...t.dirs.keys()]).toEqual(["/d1", "/d2"]);
    t.watcher.setPaths(["/d1/a.md"]);
    expect(t.closed).toEqual(["/d2"]);
    t.watcher.setPaths(["/d1/a.md", "/d1/x.md"]);
    expect([...t.dirs.keys()]).toEqual(["/d1"]);
    t.watcher.close();
    expect(t.closed).toEqual(["/d2", "/d1"]);
  });

  it("reports a change only when the stamp differs from the one the renderer holds", async () => {
    vi.useFakeTimers();
    const t = make(new Map([["/d/a.md", stamp(1)]]));
    t.watcher.setPaths(["/d/a.md"]);
    t.watcher.recordStamp("/d/a.md", stamp(1));
    t.fire("/d", "a.md");
    await vi.advanceTimersByTimeAsync(60);
    expect(t.onChanged).not.toHaveBeenCalled();

    t.stats.set("/d/a.md", stamp(2));
    t.fire("/d", "a.md");
    t.fire("/d", "a.md"); // debounced into one check
    await vi.advanceTimersByTimeAsync(49);
    expect(t.onChanged).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(t.onChanged).toHaveBeenCalledTimes(1);
    expect(t.onChanged).toHaveBeenCalledWith("/d/a.md", stamp(2));

    t.fire("/d", "a.md"); // same stamp again: silent
    await vi.advanceTimersByTimeAsync(60);
    expect(t.onChanged).toHaveBeenCalledTimes(1);
  });

  it("stays silent for files it has never handed to the renderer, and for unrelated names", async () => {
    vi.useFakeTimers();
    const t = make(new Map([["/d/a.md", stamp(1)]]));
    t.watcher.setPaths(["/d/a.md"]);
    t.fire("/d", "a.md");
    t.fire("/d", "other.md");
    await vi.advanceTimersByTimeAsync(60);
    expect(t.onChanged).not.toHaveBeenCalled();
    // now it is known; the next real change reports
    t.stats.set("/d/a.md", stamp(3));
    t.fire("/d", "a.md");
    await vi.advanceTimersByTimeAsync(60);
    expect(t.onChanged).toHaveBeenCalledWith("/d/a.md", stamp(3));
  });

  it("a null filename re-checks every watched file in that directory", async () => {
    vi.useFakeTimers();
    const t = make(
      new Map([
        ["/d/a.md", stamp(5)],
        ["/d/b.md", stamp(5)],
      ]),
    );
    t.watcher.setPaths(["/d/a.md", "/d/b.md"]);
    t.watcher.recordStamp("/d/a.md", stamp(1));
    t.watcher.recordStamp("/d/b.md", stamp(1));
    t.fire("/d", null);
    await vi.advanceTimersByTimeAsync(60);
    expect(t.onChanged).toHaveBeenCalledTimes(2);
  });

  it("reports a missing file once, then a change when it comes back", async () => {
    vi.useFakeTimers();
    const stats = new Map<string, ReturnType<typeof stamp> | null>([["/d/a.md", stamp(1)]]);
    const t = make(stats);
    t.watcher.setPaths(["/d/a.md"]);
    t.watcher.recordStamp("/d/a.md", stamp(1));
    stats.set("/d/a.md", null);
    t.fire("/d", "a.md");
    await vi.advanceTimersByTimeAsync(60);
    t.fire("/d", "a.md");
    await vi.advanceTimersByTimeAsync(60);
    expect(t.onMissing).toHaveBeenCalledTimes(1);
    stats.set("/d/a.md", stamp(7));
    t.fire("/d", "a.md");
    await vi.advanceTimersByTimeAsync(60);
    expect(t.onChanged).toHaveBeenCalledWith("/d/a.md", stamp(7));
  });

  it("checkAll re-stats everything (focus) and setPaths drops stamps of removed files", async () => {
    const stats = new Map([
      ["/d/a.md", stamp(2)],
      ["/e/b.md", stamp(2)],
    ]);
    const t = make(stats);
    t.watcher.setPaths(["/d/a.md", "/e/b.md"]);
    t.watcher.recordStamp("/d/a.md", stamp(1));
    t.watcher.recordStamp("/e/b.md", stamp(2));
    await t.watcher.checkAll();
    expect(t.onChanged).toHaveBeenCalledTimes(1);
    expect(t.onChanged).toHaveBeenCalledWith("/d/a.md", stamp(2));
    t.watcher.setPaths(["/e/b.md"]);
    t.watcher.setPaths(["/e/b.md", "/d/a.md"]);
    stats.set("/d/a.md", stamp(9));
    await t.watcher.checkAll();
    expect(t.onChanged).toHaveBeenCalledTimes(1); // forgotten → first stat is just learning
  });

  it("survives a directory that cannot be watched and a stat that throws, and ignores events after close", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const watcher = new Watcher({
      watch: () => {
        throw new Error("ENOENT");
      },
      stat: async () => {
        throw new Error("EIO");
      },
      onChanged: vi.fn(),
      onMissing: vi.fn(),
      onError,
      debounceMs: 10,
    });
    watcher.setPaths(["/gone/a.md"]);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "ENOENT" }));
    await watcher.checkAll();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "EIO" }));

    const t = make(new Map([["/d/a.md", stamp(1)]]), 10);
    t.watcher.setPaths(["/d/a.md"]);
    t.fire("/d", "a.md");
    t.watcher.close();
    await vi.advanceTimersByTimeAsync(50);
    expect(t.onChanged).not.toHaveBeenCalled();
    t.watcher.setPaths(["/d/a.md"]);
    await t.watcher.checkAll(); // closed: no-op
    expect(t.onChanged).not.toHaveBeenCalled();
  });

  it("logs with console.error by default", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const watcher = new Watcher({
      watch: () => {
        throw new Error("x");
      },
      stat: async () => null,
      onChanged: vi.fn(),
      onMissing: vi.fn(),
    });
    watcher.setPaths(["/d/a.md"]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("works against the real file system", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tiny-edit-watch-"));
    const file = join(dir, "a.md");
    fs.writeFileSync(file, "v1");
    const files = new Files(fs);
    const onChanged = vi.fn();
    const onMissing = vi.fn();
    const watcher = new Watcher({
      watch: (d, l) => fs.watch(d, l),
      stat: (p) => files.stat(p),
      onChanged,
      onMissing,
      debounceMs: 30,
    });
    try {
      watcher.setPaths([file]);
      watcher.recordStamp(file, (await files.stat(file))!);
      await new Promise((r) => setTimeout(r, 50));
      fs.writeFileSync(file, "v2 is longer");
      await vi.waitFor(
        () => expect(onChanged).toHaveBeenCalledWith(file, expect.objectContaining({ size: 12 })),
        { timeout: 3000 },
      );
      fs.unlinkSync(file);
      await vi.waitFor(() => expect(onMissing).toHaveBeenCalledWith(file), { timeout: 3000 });
    } finally {
      watcher.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
