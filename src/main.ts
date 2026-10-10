import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell } from "electron";
import path from "path";
import { Presence, SAMPLE_TRACK, buildActivity } from "./presence";
import { Settings, loadSettings, merge, saveSettings } from "./settings";
import { Tracker, TrackerState, pruneThumbs } from "./tracker";
import { checkForUpdates, getUpdateState, initUpdater, installUpdate, scheduleUpdates } from "./updater";
import { lookup } from "./yandex";

let settings: Settings;
let win: BrowserWindow | null = null;
let tray: Tray;
let quitting = false;
let last: TrackerState = { track: null, sessions: [] };
const presence = new Presence();

const root = app.getAppPath();
const icon = nativeImage.createFromPath(path.join(root, "assets", "icon.png"));
const scriptPath = path.join(root.replace("app.asar", "app.asar.unpacked"), "scripts", "smtc.ps1");
const tracker = new Tracker(scriptPath);

function openWindow(): void {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return;
  }
  win = new BrowserWindow({
    width: 980,
    height: 680,
    minWidth: 820,
    minHeight: 560,
    backgroundColor: "#1e1f22",
    autoHideMenuBar: true,
    title: "YM Presence",
    icon,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  win.removeMenu();
  win.loadFile(path.join(root, "ui", "index.html"));
  // Links in the UI open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.on("closed", () => {
    win = null;
    if (!quitting && !settings.closeToTray) app.quit();
  });
}

function applyAutoStart(): void {
  app.setLoginItemSettings({ openAtLogin: settings.autoStart });
}

function buildTrayMenu(): void {
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Открыть", click: openWindow },
      {
        label: "Показывать статус в Discord",
        type: "checkbox",
        checked: settings.enabled,
        click: (item) => update({ ...settings, enabled: item.checked }),
      },
      { type: "separator" },
      { label: "Выход", click: () => app.quit() },
    ]),
  );
}

function view() {
  const info = last.track ? lookup(last.track, settings, refresh) : {};
  const sample = !last.track;
  return {
    settings,
    update: getUpdateState(),
    version: app.getVersion(),
    track: last.track,
    sessions: last.sessions,
    discord: presence.connected,
    preview: {
      sample,
      track: last.track ?? SAMPLE_TRACK,
      info,
      activity: buildActivity(last.track ?? SAMPLE_TRACK, info, settings),
    },
  };
}

async function refresh(): Promise<void> {
  const info = last.track ? lookup(last.track, settings, refresh) : {};
  await presence.update(last.track, info, settings);
  win?.webContents.send("state", view());
}

function update(s: Settings): void {
  settings = merge(s);
  saveSettings(settings);
  applyAutoStart();
  buildTrayMenu();
  refresh();
}

// The UI is a few forms; the GPU process would cost ~50 MB for nothing.
app.disableHardwareAcceleration();

app.whenReady().then(() => {
  if (!app.requestSingleInstanceLock()) return app.quit();
  app.on("second-instance", openWindow);
  settings = loadSettings();
  applyAutoStart();

  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip("YM Presence");
  tray.on("click", openWindow);
  buildTrayMenu();

  ipcMain.handle("get", () => view());
  ipcMain.handle("set", (_e, s: Settings) => update(s));
  ipcMain.handle("reset", () => update(merge(null)));
  ipcMain.handle("check-update", () => checkForUpdates(settings));
  ipcMain.handle("install-update", () => installUpdate());
  initUpdater(() => win?.webContents.send("state", view()));
  scheduleUpdates(() => settings);

  tracker.on("state", (st: TrackerState) => {
    last = st;
    refresh();
  });
  pruneThumbs(0); // leftovers from a previous run
  tracker.start();
  if (!settings.startMinimized) openWindow();
});

app.on("window-all-closed", () => {
  /* keep running in tray */
});
app.on("before-quit", () => {
  quitting = true;
  tracker.stop();
  pruneThumbs(0);
  presence.destroy();
});
