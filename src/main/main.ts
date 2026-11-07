import "./boot";
import { app, BrowserWindow, Menu, Tray, nativeImage, nativeTheme, session, shell, Notification } from "electron";
import * as path from "path";
import { cx, UA, CX_PARTITION } from "./cx/client";
import { logger } from "./logger";
import { registerIpc, appState } from "./ipc";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const isDev = !app.isPackaged;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 660,
    show: false,
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 18, y: 20 }, vibrancy: "sidebar", visualEffectState: "followWindow" as const }
      : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1c1e00" : "#f5f5f700",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(app.getAppPath(), "src/renderer/index.html"));
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  appState.setWindow(mainWindow);
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "星跃",
      submenu: [
        { label: "关于星跃", role: "about" },
        { type: "separator" },
        { label: "隐藏", role: "hide" },
        { label: "隐藏其他", role: "hideOthers" },
        { type: "separator" },
        { label: "退出星跃", role: "quit" },
      ],
    },
    {
      label: "队列",
      submenu: [
        {
          label: "启动刷课",
          accelerator: "Cmd+R",
          click: () => appState.startQueue(),
        },
        {
          label: "暂停",
          accelerator: "Cmd+.",
          click: () => appState.pauseQueue(),
        },
      ],
    },
    { label: "编辑", role: "editMenu" },
    {
      label: "视图",
      submenu: [
        { label: "重新加载界面", accelerator: "Cmd+Shift+R", click: () => mainWindow?.webContents.reload() },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
        { role: "toggleDevTools", label: "开发者工具" },
      ],
    },
    { label: "窗口", role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createTray(): void {
  try {
    const iconPath = path.join(app.getAppPath(), "resources/trayTemplate.png");
    const img = nativeImage.createFromPath(iconPath);
    if (img.isEmpty()) return;
    img.setTemplateImage(true);
    tray = new Tray(img);
    tray.setToolTip("星跃 · 学习通助手");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "显示主窗口", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
        { type: "separator" },
        { label: "启动刷课", click: () => appState.startQueue() },
        { label: "暂停", click: () => appState.pauseQueue() },
        { type: "separator" },
        { label: "退出", click: () => app.quit() },
      ]),
    );
    tray.on("click", () => {
      mainWindow?.show();
      mainWindow?.focus();
    });
  } catch (e) {
    logger.warn("tray", `托盘初始化失败: ${e}`);
  }
}

function setupDock(): void {
  try {
    const iconPath = path.join(app.getAppPath(), "resources/icon.png");
    if (!app.isPackaged) {
      const img = nativeImage.createFromPath(iconPath);
      if (!img.isEmpty()) app.dock?.setIcon(img);
    }
  } catch {
    /* ignore */
  }
}

// Linux 云主机/虚拟机通常无 GPU，禁用硬件加速避免崩溃
if (process.platform === "linux") {
  app.disableHardwareAcceleration();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.whenReady().then(() => {
    cx.setUserAgent(UA);
    // 会话级配置：不影响渲染层默认会话
    session.fromPartition(CX_PARTITION).setUserAgent(UA);
    createWindow();
    buildMenu();
    createTray();
    setupDock();
    registerIpc();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else mainWindow?.show();
    });
  });

  app.on("window-all-closed", () => {
    // macOS 常驻（托盘可操作），除非 Cmd+Q
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    appState.persistAll();
  });
}

export { mainWindow };
