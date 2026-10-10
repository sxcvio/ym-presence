import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  get: () => ipcRenderer.invoke("get"),
  set: (s: unknown) => ipcRenderer.invoke("set", s),
  reset: () => ipcRenderer.invoke("reset"),
  checkUpdate: () => ipcRenderer.invoke("check-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onState: (cb: (s: unknown) => void) => ipcRenderer.on("state", (_e, s) => cb(s)),
});
