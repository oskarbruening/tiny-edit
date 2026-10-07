import { afterEach, describe, expect, it, vi } from "vitest";
import { Autosave, type FileMeta } from "../../../src/renderer/autosave";
import type { WriteFileRequest } from "../../../src/shared/ipc";

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

const stamp = (n: number) => ({ mtimeMs: n, size: n });

function make(idleMs = 300) {
  const texts = new Map<string, string>([
    ["/a.md", "A"],
    ["/b.md", "B"],
  ]);
  const meta = new Map<string, FileMeta>([["/a.md", { eol: "\r\n", bom: true, stamp: stamp(1) }]]);
  const writeFile = vi.fn(async (_req: WriteFileRequest) => ({ ok: true as const, stamp: stamp(2) }));
  const hooks = { onSaved: vi.fn(), onConflict: vi.fn(), onError: vi.fn() };
  const autosave = new Autosave({
    api: { writeFile },
    text: (p) => texts.get(p) ?? null,
    meta,
    idleMs,
    ...hooks,
  });
  return { autosave, writeFile, texts, meta, ...hooks };
}

afterEach(() => vi.useRealTimers());

describe("Autosave", () => {
  it("writes after the idle period with the file's eol/bom/stamp and records the new stamp", async () => {
    vi.useFakeTimers();
    const { autosave, writeFile, meta, onSaved } = make();
    autosave.markDirty("/a.md");
    expect(autosave.isDirty("/a.md")).toBe(true);
    vi.advanceTimersByTime(299);
    expect(writeFile).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(writeFile).toHaveBeenCalledWith({
      path: "/a.md",
      text: "A",
      eol: "\r\n",
      bom: true,
      expected: stamp(1),
      force: false,
    });
    await vi.runAllTimersAsync();
    expect(meta.get("/a.md")?.stamp).toEqual(stamp(2));
    expect(onSaved).toHaveBeenCalledWith("/a.md", stamp(2));
    expect(autosave.isDirty("/a.md")).toBe(false);
  });

  it("re-arms the timer on every edit and writes each dirty file once", async () => {
    vi.useFakeTimers();
    const { autosave, writeFile } = make();
    autosave.markDirty("/a.md");
    vi.advanceTimersByTime(200);
    autosave.markDirty("/b.md");
    vi.advanceTimersByTime(200);
    expect(writeFile).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(
      writeFile.mock.calls.map((c) => (c as unknown as [{ path: string; expected: unknown }])[0]),
    ).toEqual([
      expect.objectContaining({ path: "/a.md" }),
      expect.objectContaining({ path: "/b.md", eol: "\n", bom: false, expected: null }),
    ]);
  });

  it("flush() writes immediately and cancels the timer; flush(path) only that file", async () => {
    vi.useFakeTimers();
    const { autosave, writeFile } = make();
    autosave.markDirty("/a.md");
    autosave.markDirty("/b.md");
    await autosave.flush("/b.md");
    expect(writeFile).toHaveBeenCalledTimes(1);
    expect(writeFile.mock.calls[0]![0]).toMatchObject({ path: "/b.md" });
    await autosave.flush();
    expect(writeFile).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1000);
    expect(writeFile).toHaveBeenCalledTimes(2);
    await autosave.flush("/nope.md");
    expect(writeFile).toHaveBeenCalledTimes(2);
  });

  it("queues edits made during an in-flight write and writes again afterwards", async () => {
    const { autosave, writeFile, texts } = make();
    const first = deferred<{ ok: true; stamp: { mtimeMs: number; size: number } }>();
    writeFile.mockReturnValueOnce(first.promise);
    autosave.markDirty("/a.md");
    const flushing = autosave.flush();
    expect(writeFile).toHaveBeenCalledTimes(1);
    texts.set("/a.md", "A2");
    autosave.markDirty("/a.md");
    const second = autosave.flush("/a.md");
    first.resolve({ ok: true, stamp: stamp(5) });
    await flushing;
    await second;
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writeFile.mock.calls[1]![0]).toMatchObject({ text: "A2", expected: stamp(5) });
    expect(autosave.isDirty("/a.md")).toBe(false);
  });

  it("parks a conflicting file: no further writes until resolved; keep-mine forces, reload drops", async () => {
    const { autosave, writeFile, onConflict, texts } = make();
    writeFile.mockResolvedValueOnce({ ok: false, conflict: stamp(9) } as never);
    autosave.markDirty("/a.md");
    await autosave.flush();
    expect(onConflict).toHaveBeenCalledWith("/a.md", stamp(9));
    expect(autosave.isParked("/a.md")).toBe(true);
    expect(autosave.isDirty("/a.md")).toBe(true);

    autosave.markDirty("/a.md");
    await autosave.flush();
    expect(writeFile).toHaveBeenCalledTimes(1);

    await autosave.resolve("/a.md", "keep-mine");
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(writeFile.mock.calls[1]![0]).toMatchObject({ force: true });
    expect(autosave.isParked("/a.md")).toBe(false);
    expect(autosave.isDirty("/a.md")).toBe(false);

    writeFile.mockResolvedValueOnce({ ok: false, conflict: stamp(10) } as never);
    texts.set("/a.md", "A3");
    autosave.markDirty("/a.md");
    await autosave.flush();
    await autosave.resolve("/a.md", "reload");
    expect(autosave.isDirty("/a.md")).toBe(false);
    expect(writeFile).toHaveBeenCalledTimes(3);
  });

  it("keeps the file dirty and reports when the write throws", async () => {
    const { autosave, writeFile, onError } = make();
    writeFile.mockRejectedValueOnce(new Error("EACCES"));
    autosave.markDirty("/a.md");
    await autosave.flush();
    expect(onError).toHaveBeenCalledWith("/a.md", expect.objectContaining({ message: "EACCES" }));
    expect(autosave.isDirty("/a.md")).toBe(true);
    await autosave.flush();
    expect(writeFile).toHaveBeenCalledTimes(2);
    expect(autosave.isDirty("/a.md")).toBe(false);
  });

  it("drops files that are no longer open or were forgotten", async () => {
    const { autosave, writeFile } = make();
    autosave.markDirty("/gone.md");
    await autosave.flush();
    expect(writeFile).not.toHaveBeenCalled();
    autosave.markDirty("/a.md");
    autosave.forget("/a.md");
    await autosave.flush();
    expect(writeFile).not.toHaveBeenCalled();
    expect(autosave.isDirty("/a.md")).toBe(false);
  });

  it("park() holds writes until resolved", async () => {
    const { autosave, writeFile } = make();
    autosave.park("/a.md");
    autosave.markDirty("/a.md");
    await autosave.flush();
    expect(writeFile).not.toHaveBeenCalled();
    expect(autosave.isDirty("/a.md")).toBe(true);
    await autosave.resolve("/a.md", "keep-mine");
    expect(writeFile).toHaveBeenCalledTimes(1);
  });
});
