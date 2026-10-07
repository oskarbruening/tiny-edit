import { afterEach, describe, expect, it, vi } from "vitest";
import { trackWindowState, validateBounds } from "../../../src/main/windowState";

const display = (x: number, y: number, width: number, height: number) => ({
  workArea: { x, y, width, height },
});
const main = display(0, 0, 1920, 1055);

describe("validateBounds", () => {
  it("keeps a position that lies on a connected display", () => {
    expect(validateBounds({ x: 100, y: 100, width: 950, height: 500 }, [main])).toEqual({
      x: 100,
      y: 100,
      width: 950,
      height: 500,
    });
  });

  it("drops the position when the window is on an unplugged display", () => {
    expect(validateBounds({ x: 2500, y: 100, width: 950, height: 500 }, [main])).toEqual({
      width: 950,
      height: 500,
    });
    expect(validateBounds({ x: -2000, y: -2000, width: 950, height: 500 }, [main])).toEqual({
      width: 950,
      height: 500,
    });
  });

  it("accepts a window hanging partly off-screen as long as 100 px remain", () => {
    expect(validateBounds({ x: 1850, y: 980, width: 950, height: 500 }, [main])).toEqual({
      width: 950,
      height: 500,
    });
    expect(validateBounds({ x: 1820, y: 955, width: 950, height: 500 }, [main])).toEqual({
      x: 1820,
      y: 955,
      width: 950,
      height: 500,
    });
  });

  it("matches secondary displays, including negative coordinates", () => {
    const left = display(-1440, 0, 1440, 900);
    expect(validateBounds({ x: -1000, y: 50, width: 800, height: 600 }, [main, left])).toMatchObject({
      x: -1000,
      y: 50,
    });
  });

  it("clamps size to the minimum and passes through position-less bounds", () => {
    expect(validateBounds({ width: 10, height: 10 }, [main])).toEqual({ width: 400, height: 300 });
    expect(validateBounds({ x: 0, y: 0, width: 10, height: 10 }, [main])).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
  });

  it("drops position when there are no displays at all", () => {
    expect(validateBounds({ x: 0, y: 0, width: 950, height: 500 }, [])).toEqual({ width: 950, height: 500 });
  });
});

function fakeWindow(bounds = { x: 1, y: 2, width: 950, height: 500 }) {
  const listeners = new Map<string, () => void>();
  return {
    bounds,
    fullScreen: false,
    minimized: false,
    emit(event: string) {
      listeners.get(event)?.();
    },
    win: {
      on: (event: string, cb: () => void) => listeners.set(event, cb),
      getNormalBounds: () => bounds,
      isFullScreen() {
        return false;
      },
      isMinimized() {
        return false;
      },
    },
  };
}

describe("trackWindowState", () => {
  afterEach(() => vi.useRealTimers());

  it("reports normal bounds once after resize/move settle", () => {
    vi.useFakeTimers();
    const f = fakeWindow();
    const onChange = vi.fn();
    trackWindowState(f.win, { onChange, debounceMs: 250 });
    f.emit("resize");
    f.emit("move");
    f.emit("resize");
    vi.advanceTimersByTime(249);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ x: 1, y: 2, width: 950, height: 500 });
  });

  it("reports immediately on close and cancels the pending timer", () => {
    vi.useFakeTimers();
    const f = fakeWindow();
    const onChange = vi.fn();
    trackWindowState(f.win, { onChange });
    f.emit("move");
    f.emit("close");
    expect(onChange).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("skips fullscreen and minimised states", () => {
    vi.useFakeTimers();
    const f = fakeWindow();
    const onChange = vi.fn();
    f.win.isFullScreen = () => true;
    trackWindowState(f.win, { onChange });
    f.emit("close");
    f.win.isFullScreen = () => false;
    f.win.isMinimized = () => true;
    f.emit("close");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("dispose cancels a pending report", () => {
    vi.useFakeTimers();
    const f = fakeWindow();
    const onChange = vi.fn();
    const dispose = trackWindowState(f.win, { onChange });
    f.emit("resize");
    dispose();
    dispose();
    vi.advanceTimersByTime(1000);
    expect(onChange).not.toHaveBeenCalled();
  });
});
