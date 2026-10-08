import { afterEach, describe, expect, it, vi } from "vitest";
import { FlushGate, guardClose } from "../../../src/main/flushGate";

afterEach(() => vi.useRealTimers());

const target = (id: number) => ({ id, send: vi.fn() });

describe("FlushGate", () => {
  it("resolves 'flushed' with the renderer's pending list when it acks", async () => {
    const gate = new FlushGate(1000);
    const t = target(1);
    const p = gate.request(t);
    expect(t.send).toHaveBeenCalledWith("renderer:flush");
    gate.notify(1, ["/a.md"]);
    await expect(p).resolves.toEqual({ status: "flushed", pending: ["/a.md"] });
    const q = gate.request(t);
    gate.notify(1);
    await expect(q).resolves.toEqual({ status: "flushed", pending: [] });
  });

  it("resolves 'timeout' when the renderer never answers, and ignores late or foreign acks", async () => {
    vi.useFakeTimers();
    const gate = new FlushGate(2000);
    const p = gate.request(target(7));
    gate.notify(99);
    vi.advanceTimersByTime(1999);
    gate.notify(99);
    vi.advanceTimersByTime(1);
    await expect(p).resolves.toEqual({ status: "timeout" });
    gate.notify(7); // nothing pending; must not throw
  });

  it("defaults to a 2 s cap", async () => {
    vi.useFakeTimers();
    const p = new FlushGate().request(target(1));
    vi.advanceTimersByTime(2000);
    await expect(p).resolves.toEqual({ status: "timeout" });
  });
});

describe("guardClose", () => {
  function fakeWindow() {
    let onClose: ((e: { preventDefault(): void }) => void) | null = null;
    const win = {
      on: vi.fn((_: "close", cb: (e: { preventDefault(): void }) => void) => (onClose = cb)),
      destroy: vi.fn(),
      webContents: target(3),
    };
    return {
      win,
      close: () => {
        const e = { preventDefault: vi.fn() };
        onClose!(e);
        return e;
      },
    };
  }

  it("prevents the first close, flushes renderer then state, destroys, and lets the next close through", async () => {
    const gate = new FlushGate(1000);
    const { win, close } = fakeWindow();
    const order: string[] = [];
    guardClose(win, gate, () => order.push("state"));
    const first = close();
    expect(first.preventDefault).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith("renderer:flush");
    expect(win.destroy).not.toHaveBeenCalled();
    gate.notify(3);
    await vi.waitFor(() => expect(win.destroy).toHaveBeenCalledTimes(1));
    expect(order).toEqual(["state"]);
    const second = close();
    expect(second.preventDefault).not.toHaveBeenCalled();
  });

  it("asks before discarding unsaved edits; Cancel keeps the window and a later close asks again", async () => {
    const gate = new FlushGate(1000);
    const { win, close } = fakeWindow();
    const confirm = vi.fn(async () => false);
    guardClose(win, gate, () => undefined, confirm);
    close();
    gate.notify(3, ["/a.md", "/b.md"]);
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledWith(["/a.md", "/b.md"]));
    await new Promise((r) => setTimeout(r, 5));
    expect(win.destroy).not.toHaveBeenCalled();

    confirm.mockResolvedValueOnce(true);
    close(); // the conflict is still there, but this time the user says quit
    gate.notify(3, ["/a.md"]);
    await vi.waitFor(() => expect(win.destroy).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("a second close while the first is still flushing is ignored, not queued", async () => {
    const gate = new FlushGate(1000);
    const { win, close } = fakeWindow();
    guardClose(win, gate, () => undefined);
    close();
    const again = close();
    expect(again.preventDefault).toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledTimes(1);
    gate.notify(3);
    await vi.waitFor(() => expect(win.destroy).toHaveBeenCalledTimes(1));
  });

  it("a frozen renderer (timeout) asks with null; the default confirmer closes anyway", async () => {
    vi.useFakeTimers();
    const gate = new FlushGate(50);
    const { win, close } = fakeWindow();
    const confirm = vi.fn(async () => true);
    guardClose(win, gate, () => undefined, confirm);
    close();
    await vi.advanceTimersByTimeAsync(50);
    expect(confirm).toHaveBeenCalledWith(null);
    await vi.waitFor(() => expect(win.destroy).toHaveBeenCalledTimes(1));

    const other = fakeWindow();
    guardClose(other.win, new FlushGate(50), () => undefined); // no confirmer injected
    other.close();
    await vi.advanceTimersByTimeAsync(50);
    await vi.waitFor(() => expect(other.win.destroy).toHaveBeenCalledTimes(1));
  });
});
