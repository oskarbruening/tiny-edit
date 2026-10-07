import { vi } from "vitest";

// Every module under src/main and src/preload takes its Electron dependencies as
// parameters; this mock only exists so an accidental direct import fails loudly
// instead of trying to load the real binary.
vi.mock("electron", () => {
  const fail = (name: string) => () => {
    throw new Error(`electron.${name} used directly in a unit test — inject it instead`);
  };
  return {
    app: new Proxy({}, { get: (_t, p) => fail(`app.${String(p)}`) }),
    BrowserWindow: fail("BrowserWindow"),
    contextBridge: { exposeInMainWorld: fail("contextBridge.exposeInMainWorld") },
    ipcMain: { handle: fail("ipcMain.handle"), on: fail("ipcMain.on") },
    ipcRenderer: { invoke: fail("ipcRenderer.invoke"), on: fail("ipcRenderer.on") },
  };
});
