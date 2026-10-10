import { app } from "electron";
import fs from "fs";
import path from "path";
import { autoUpdater } from "electron-updater";
import { Settings } from "./settings";

/** owner/repo come from package.json → build.publish, which electron-builder bakes into app-update.yml. */
function readRepo(): { owner: string; repo: string } | null {
  try {
    const yml = fs.readFileSync(path.join(process.resourcesPath, "app-update.yml"), "utf8");
    const owner = /^owner:\s*(\S+)/m.exec(yml)?.[1];
    const repo = /^repo:\s*(\S+)/m.exec(yml)?.[1];
    return owner && repo ? { owner, repo } : null;
  } catch {
    return null;
  }
}

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "none" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; percent: number }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string };

let state: UpdateState = { kind: "idle" };
let listener: (s: UpdateState) => void = () => {};
let timer: NodeJS.Timeout | undefined;

const set = (s: UpdateState) => {
  state = s;
  listener(s);
};

export const getUpdateState = () => state;

export function initUpdater(onChange: (s: UpdateState) => void): void {
  listener = onChange;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => set({ kind: "checking" }));
  autoUpdater.on("update-not-available", () => set({ kind: "none" }));
  autoUpdater.on("update-available", (i) => set({ kind: "available", version: i.version }));
  autoUpdater.on("download-progress", (p) => set({ kind: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (i) => set({ kind: "ready", version: i.version }));
  autoUpdater.on("error", (e) => set({ kind: "error", message: friendly(e) }));
}

function friendly(e: Error): string {
  const m = String(e?.message ?? e);
  if (/401|403|404|Not Found|Bad credentials/i.test(m)) return "Нет доступа к репозиторию: проверьте токен GitHub.";
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|net::/i.test(m)) return "Нет связи с GitHub.";
  return m.split("\n")[0].slice(0, 200);
}

export async function checkForUpdates(s: Settings): Promise<void> {
  if (!app.isPackaged) return set({ kind: "error", message: "Обновления работают только в установленной версии." });
  if (!s.githubToken.trim()) return set({ kind: "error", message: "Укажите токен GitHub, чтобы проверять обновления." });
  const repo = readRepo();
  if (!repo) return set({ kind: "error", message: "Не найден адрес репозитория обновлений." });
  autoUpdater.setFeedURL({ provider: "github", ...repo, private: true, token: s.githubToken.trim() });
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    /* reported through the "error" event */
  }
}

/** Checks now and then every 4 hours while the app runs. */
export function scheduleUpdates(getSettings: () => Settings): void {
  clearInterval(timer);
  const run = () => {
    if (getSettings().autoUpdate && getSettings().githubToken.trim()) checkForUpdates(getSettings());
  };
  setTimeout(run, 10_000);
  timer = setInterval(run, 4 * 60 * 60 * 1000);
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true);
}
