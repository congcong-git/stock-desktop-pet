/**
 * 授权签发可视化工具（独立 Electron 窗口，不参与打包）
 * 启动：npm run license-admin
 *
 * 说明：这是一个独立入口，用 electron 直接运行本文件；
 *       项目打包配置（package.json build.files）只包含 dist / electron / package.json，
 *       因此本工具不会出现在用户安装包里。
 */
const { app, BrowserWindow, clipboard, ipcMain } = require("electron");
const path = require("path");
const store = require("./license-store");

let mainWindow = null;

function createWindow() {
  const window = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 780,
    minHeight: 560,
    title: "牛来 · 授权签发工具",
    backgroundColor: "#0f172a",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "license-admin-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  window.loadFile(path.join(__dirname, "..", "dist", "license-admin.html"));
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  mainWindow = window;
}

ipcMain.handle("license-admin:list", async () => {
  return store.list();
});

ipcMain.handle("license-admin:issue", async (_event, payload) => {
  return store.issue(payload || {});
});

ipcMain.handle("license-admin:revoke", async (_event, machineId) => {
  return store.revoke(machineId);
});

ipcMain.handle("license-admin:keygen", async () => {
  try {
    store.generateKeyPair();
    return { ok: true, publicKey: store.readPublicKey() };
  } catch (_error) {
    return { ok: false, message: "密钥生成失败" };
  }
});

ipcMain.handle("license-admin:copy", async (_event, text) => {
  clipboard.writeText(String(text || ""));
  return true;
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
