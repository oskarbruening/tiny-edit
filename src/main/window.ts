import type { BrowserWindow as BrowserWindowType, BrowserWindowConstructorOptions } from "electron";
import { DEFAULT_BACKGROUND, DEFAULT_WINDOW, MIN_WINDOW, APP_NAME } from "../shared/constants";

export type Bounds = { x?: number; y?: number; width: number; height: number };

export type WindowOptionsInput = {
  preloadPath: string;
  backgroundColor?: string;
  bounds?: Bounds;
};

/** Pure: the BrowserWindow options. Security-relevant flags are explicit so a test can pin them. */
export function windowOptions(input: WindowOptionsInput): BrowserWindowConstructorOptions {
  const bounds: Bounds = input.bounds ?? DEFAULT_WINDOW;
  return {
    title: APP_NAME,
    width: bounds.width,
    height: bounds.height,
    ...(bounds.x !== undefined && bounds.y !== undefined ? { x: bounds.x, y: bounds.y } : {}),
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
    show: false,
    backgroundColor: input.backgroundColor ?? DEFAULT_BACKGROUND,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: input.preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  };
}

export type WindowDeps = {
  BrowserWindow: new (opts: BrowserWindowConstructorOptions) => BrowserWindowType;
  /** The dev server URL (electron-vite's ELECTRON_RENDERER_URL) or the `app://renderer/index.html` production URL. */
  rendererUrl: string;
};

/** Creates the hidden main window and shows it on ready-to-show (no white flash). */
export function createMainWindow(deps: WindowDeps, input: WindowOptionsInput): BrowserWindowType {
  const win = new deps.BrowserWindow(windowOptions(input));
  win.once("ready-to-show", () => win.show());
  void win.loadURL(deps.rendererUrl);
  return win;
}
