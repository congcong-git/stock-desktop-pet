const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("stockWatcher", {
  getBootstrap: () => ipcRenderer.invoke("app:get-bootstrap"),
  searchStocks: (keyword) => ipcRenderer.invoke("stocks:search", keyword),
  addWatchlist: (stock) => ipcRenderer.invoke("watchlist:add", stock),
  saveHolding: (payload) => ipcRenderer.invoke("holding:save", payload),
  updateHolding: (payload) => ipcRenderer.invoke("holding:update", payload),
  removeWatchlist: (code) => ipcRenderer.invoke("watchlist:remove", code),
  removeHolding: (code) => ipcRenderer.invoke("holding:remove", code),
  refreshMarket: () => ipcRenderer.invoke("market:refresh"),
  getSnapshots: () => ipcRenderer.invoke("snapshot:get"),
  openDataDir: () => ipcRenderer.invoke("data:open-dir"),
  openPetMenu: (state) => ipcRenderer.send("pet:open-menu", state),
  onSetPetMood: (callback) => {
    const listener = (_event, mood) => callback(mood);
    ipcRenderer.on("pet:set-mood", listener);
    return () => ipcRenderer.removeListener("pet:set-mood", listener);
  },
  onPetCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on("pet:command", listener);
    return () => ipcRenderer.removeListener("pet:command", listener);
  },
  getMedia: async () => {
    try {
      return await ipcRenderer.invoke("media:list");
    } catch (_error) {
      return [];
    }
  },
  getMoodBindings: () => ipcRenderer.invoke("media:get-bindings"),
  setMoodBindings: (bindings) => ipcRenderer.invoke("media:set-bindings", bindings),
  pickMediaImport: () => ipcRenderer.invoke("media:pick-import"),
  deleteMediaItem: (name) => ipcRenderer.invoke("media:delete-item", name),
  renameMediaItem: (oldName, newName) => ipcRenderer.invoke("media:rename-item", { oldName, newName }),
  previewMedia: (item) => ipcRenderer.invoke("media:preview-item", item),
  saveRemovedBg: (payload) => ipcRenderer.invoke("media:save-removed-bg", payload),
  onMoodBindingsChanged: (callback) => {
    const listener = (_event, bindings) => callback(bindings);
    ipcRenderer.on("media:bindings-changed", listener);
    return () => ipcRenderer.removeListener("media:bindings-changed", listener);
  },
  onMediaLibraryChanged: (callback) => {
    const listener = (_event, items) => callback(items);
    ipcRenderer.on("media:library-changed", listener);
    return () => ipcRenderer.removeListener("media:library-changed", listener);
  }
});
