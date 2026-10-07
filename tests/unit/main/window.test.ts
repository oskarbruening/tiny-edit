import { describe, expect, it, vi } from "vitest";
import { createMainWindow, windowOptions } from "../../../src/main/window";
import { DEFAULT_BACKGROUND, DEFAULT_WINDOW, MIN_WINDOW } from "../../../src/shared/constants";

describe("windowOptions", () => {
  it("defaults to 950×500 with the sidebar+editor split and the theme background", () => {
    const opts = windowOptions({ preloadPath: "/p/preload.js" });
    expect(opts.width).toBe(DEFAULT_WINDOW.width);
    expect(opts.width).toBe(950);
    expect(opts.height).toBe(500);
    expect(opts.minWidth).toBe(MIN_WINDOW.width);
    expect(opts.minHeight).toBe(MIN_WINDOW.height);
    expect(opts.backgroundColor).toBe(DEFAULT_BACKGROUND);
    expect(opts.show).toBe(false);
    expect(opts.x).toBeUndefined();
    expect(opts.y).toBeUndefined();
  });

  it("pins the security flags", () => {
    const wp = windowOptions({ preloadPath: "/p/preload.js" }).webPreferences;
    expect(wp).toMatchObject({
      preload: "/p/preload.js",
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    });
  });

  it("uses macOS inset title bar", () => {
    const opts = windowOptions({ preloadPath: "x" });
    expect(opts.titleBarStyle).toBe("hiddenInset");
    expect(opts.trafficLightPosition).toEqual({ x: 12, y: 12 });
  });

  it("applies saved bounds and background when given", () => {
    const opts = windowOptions({
      preloadPath: "x",
      backgroundColor: "#000000",
      bounds: { x: 10, y: 20, width: 800, height: 600 },
    });
    expect(opts).toMatchObject({ x: 10, y: 20, width: 800, height: 600, backgroundColor: "#000000" });
  });

  it("omits position when only size is saved", () => {
    const opts = windowOptions({ preloadPath: "x", bounds: { width: 800, height: 600 } });
    expect(opts.x).toBeUndefined();
    expect(opts.width).toBe(800);
  });
});

function fakeBrowserWindow() {
  const instances: FakeWin[] = [];
  class FakeWin {
    opts: unknown;
    handlers = new Map<string, () => void>();
    show = vi.fn();
    loadURL = vi.fn(() => Promise.resolve());
    constructor(opts: unknown) {
      this.opts = opts;
      instances.push(this);
    }
    once(event: string, cb: () => void) {
      this.handlers.set(event, cb);
      return this;
    }
  }
  return { FakeWin, instances };
}

describe("createMainWindow", () => {
  it("loads the given renderer URL and shows on ready-to-show", () => {
    const { FakeWin, instances } = fakeBrowserWindow();
    const win = createMainWindow(
      { BrowserWindow: FakeWin as never, rendererUrl: "http://localhost:5173" },
      { preloadPath: "/out/preload.js" },
    );
    const inst = instances[0]!;
    expect(win).toBe(inst);
    expect(inst.loadURL).toHaveBeenCalledWith("http://localhost:5173");
    expect(inst.show).not.toHaveBeenCalled();
    inst.handlers.get("ready-to-show")!();
    expect(inst.show).toHaveBeenCalledTimes(1);
  });

  it("loads the app:// URL in production", () => {
    const { FakeWin, instances } = fakeBrowserWindow();
    createMainWindow(
      { BrowserWindow: FakeWin as never, rendererUrl: "app://renderer/index.html" },
      { preloadPath: "/out/preload.js" },
    );
    expect(instances[0]!.loadURL).toHaveBeenCalledWith("app://renderer/index.html");
  });
});
