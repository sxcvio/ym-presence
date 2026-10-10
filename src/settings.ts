import { app } from "electron";
import fs from "fs";
import path from "path";

export interface ButtonCfg {
  enabled: boolean;
  label: string;
  url: string;
}

export interface Settings {
  // behaviour
  enabled: boolean;
  hideOnPause: boolean;
  autoStart: boolean;
  startMinimized: boolean;
  closeToTray: boolean;
  autoUpdate: boolean;
  /** Read-only GitHub token for updates from the private repo; stored only in the local settings file. */
  githubToken: string;
  // text (templates, see PLACEHOLDERS in presence.ts)
  activityName: string;
  statusDisplay: "name" | "state" | "details";
  details: string;
  detailsUrl: string;
  state: string;
  stateUrl: string;
  // images
  showCover: boolean;
  uploadCovers: boolean;
  fallbackImage: string;
  largeText: string;
  coverUrl: string;
  smallImage: string;
  smallText: string;
  // progress
  showProgress: boolean;
  buttons: [ButtonCfg, ButtonCfg];
}

export const defaults: Settings = {
  enabled: true,
  hideOnPause: true,
  autoStart: false,
  startMinimized: false,
  closeToTray: true,
  autoUpdate: true,
  githubToken: "",
  activityName: "",
  statusDisplay: "name",
  details: "{title}",
  detailsUrl: "",
  state: "{artist}",
  stateUrl: "",
  showCover: true,
  uploadCovers: true,
  fallbackImage: "logo",
  largeText: "{album}",
  coverUrl: "",
  smallImage: "",
  smallText: "",
  showProgress: true,
  buttons: [
    { enabled: true, label: "Слушать на Яндекс Музыке", url: "{url}" },
    { enabled: false, label: "", url: "" },
  ],
};

const file = () => path.join(app.getPath("userData"), "settings.json");

export function merge(raw: any): Settings {
  const s: Settings = { ...defaults, ...(raw ?? {}) };
  s.buttons = [0, 1].map((i) => ({ ...defaults.buttons[i], ...(raw?.buttons?.[i] ?? {}) })) as Settings["buttons"];
  return s;
}

export function loadSettings(): Settings {
  try {
    return merge(JSON.parse(fs.readFileSync(file(), "utf8")));
  } catch {
    return merge(null);
  }
}

export function saveSettings(s: Settings): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(s, null, 2));
}
