// Wiring only (sandboxed CJS; may import nothing but `electron`).
import { contextBridge, ipcRenderer, webUtils } from "electron";
import { createApi } from "./api";

contextBridge.exposeInMainWorld(
  "api",
  createApi({
    versions: process.versions,
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    pathForFile: (file) => webUtils.getPathForFile(file),
    on: (channel, listener) => ipcRenderer.on(channel, listener),
    off: (channel, listener) => ipcRenderer.removeListener(channel, listener),
  }),
);
