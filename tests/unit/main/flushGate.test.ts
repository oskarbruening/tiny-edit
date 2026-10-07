import { afterEach, describe, expect, it, vi } from "vitest";
import { FlushGate, guardClose } from "../../../src/main/flushGate";

afterEach(() => vi.useRealTimers());

const target = (id: number) => ({ id, send: vi.fn() });

describe("FlushGate", () => {
  it("resolves 'flushed' when the renderer acks", async () => {
    const gate = new FlushGate(1000);
    const t = target(1);
    const p = gate.request(t);
    expect(t.send).toHaveBeenCalledWith("renderer:flush");
    gate.notify(1);
    await expect(p).resolves.toBe("flushed");
  });

  it("resolves 'timeout' when the renderer never answers, and ignores late or foreign acks", async () => {
    vi.useFakeTimers();
    const gate = new FlushGate(2000);
    const p = gate.request(target(7));
    gate.notify(99);
    vi.advanceTimersByTime(1999);
    gate.notify(99);
    vi.advanceTimersByTime(1);
    await expect(p).resolves.toBe("timeout");
    gate.notify(7); // nothing pending; must not throw
  });

  it("defaults to a 2 s cap", async () => {
    vi.useFakeTimers();
    const p = new FlushGate().request(target(1));
    vi.advanceTimersByTime(2000);
    await expect(p).resolves.toBe("timeout");
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
});
