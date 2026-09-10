const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("licenseAdmin", {
  list: () => ipcRenderer.invoke("license-admin:list"),
  issue: (payload) => ipcRenderer.invoke("license-admin:issue", payload),
  revoke: (machineId) => ipcRenderer.invoke("license-admin:revoke", machineId),
  keygen: () => ipcRenderer.invoke("license-admin:keygen"),
  copy: (text) => ipcRenderer.invoke("license-admin:copy", text)
});
