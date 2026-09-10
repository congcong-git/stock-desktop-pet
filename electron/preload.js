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
  getAppConfig: () => ipcRenderer.invoke("app:get-config"),
  setAutoLaunch: (enabled) => ipcRenderer.invoke("app:set-auto-launch", enabled),
  setGuideSeen: () => ipcRenderer.invoke("app:set-guide-seen"),
  setRefreshSeconds: (seconds) => ipcRenderer.invoke("app:set-refresh-seconds", seconds),
  checkForUpdates: () => ipcRenderer.invoke("app:check-updates"),
  setCompanionConfig: (partial) => ipcRenderer.invoke("app:set-companion", partial),
  notifyAlert: (payload) => ipcRenderer.invoke("notify:alert", payload),
  // —— 离线授权 ——
  getLicenseStatus: () => ipcRenderer.invoke("license:status"),
  getLicenseInfo: () => ipcRenderer.invoke("license:info"),
  activateLicense: (code) => ipcRenderer.invoke("license:activate", code),
  copyLicenseMachineId: (machineId) => ipcRenderer.invoke("license:copy-machine-id", machineId),
  onAppConfigChanged: (callback) => {
    const listener = (_event, config) => callback(config);
    ipcRenderer.on("app:config-changed", listener);
    return () => ipcRenderer.removeListener("app:config-changed", listener);
  },
  openPetMenu: (state) => ipcRenderer.send("pet:open-menu", state),
  // 宠物右键菜单打开面板时携带的直达意图（search / manage / snapshot）
  onPanelMode: (callback) => {
    const listener = (_event, mode) => callback(mode);
    ipcRenderer.on("panel:mode", listener);
    return () => ipcRenderer.removeListener("panel:mode", listener);
  },
  // —— 宠物窗口位置微调（拖动本身走系统 drag region，这里只做键盘微调）——
  nudgePetWindow: (dx, dy) => ipcRenderer.send("pet:nudge", { dx, dy }),
  onSetPetMood: (callback) => {
    const listener = (_event, mood) => callback(mood);
    ipcRenderer.on("pet:set-mood", listener);
    return () => ipcRenderer.removeListener("pet:set-mood", listener);
  },
  // 预览状态形象（awake / rest / doze / sleep），"auto" 恢复为按时段自动
  onSetPetState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("pet:set-state", listener);
    return () => ipcRenderer.removeListener("pet:set-state", listener);
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
