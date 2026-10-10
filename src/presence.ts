import { Client, SetActivity } from "@xhayper/discord-rpc";
import { Settings } from "./settings";
import { Track } from "./tracker";
import { TrackInfo } from "./yandex";

const CLIENT_ID = "1424709900440698930";
const LISTENING = 2;

export const SAMPLE_TRACK: Track = {
  title: "Название трека",
  artist: "Исполнитель",
  album: "Альбом",
  playing: true,
  position: 42,
  duration: 187,
};

const mmss = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Replaces {title}, {artist}, {album}, {url}, {duration}, {position} in a template. */
export function render(tpl: string, t: Track, info: TrackInfo): string {
  const vars: Record<string, string> = {
    title: t.title,
    artist: t.artist,
    album: t.album,
    url: info.url ?? "",
    duration: mmss(t.duration),
    position: mmss(t.position),
  };
  return tpl.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m).trim();
}

// Discord rejects texts shorter than 2 or longer than 128 characters.
const text = (v: string, max = 128) => (v.length >= 2 ? v.slice(0, max) : undefined);
const link = (v: string) => (/^https?:\/\/\S+$/i.test(v) && v.length <= 512 ? v : undefined);

export function buildActivity(t: Track, info: TrackInfo, s: Settings): SetActivity {
  const r = (tpl: string) => render(tpl, t, info);
  const a: SetActivity = { type: LISTENING };

  if (s.activityName.trim()) a.name = text(r(s.activityName), 128);
  a.statusDisplayType = ({ name: 0, state: 1, details: 2 } as const)[s.statusDisplay];

  a.details = text(r(s.details));
  a.state = text(r(s.state));
  if (a.details) a.detailsUrl = link(r(s.detailsUrl));
  if (a.state) a.stateUrl = link(r(s.stateUrl));

  if (s.showCover && info.cover) a.largeImageKey = info.cover;
  else if (s.fallbackImage.trim()) a.largeImageKey = s.fallbackImage.trim();
  if (a.largeImageKey) {
    a.largeImageText = text(r(s.largeText));
    a.largeImageUrl = link(r(s.coverUrl));
  }
  if (s.smallImage.trim()) {
    a.smallImageKey = s.smallImage.trim();
    a.smallImageText = text(r(s.smallText));
  }

  if (s.showProgress && t.playing && t.duration > 0) {
    const start = Math.floor((Date.now() - t.position * 1000) / 1000) * 1000;
    a.startTimestamp = start;
    a.endTimestamp = start + t.duration * 1000;
  }

  const buttons = s.buttons
    .filter((b) => b.enabled)
    .map((b) => ({ label: r(b.label).slice(0, 32), url: link(r(b.url)) }))
    .filter((b): b is { label: string; url: string } => b.label.length > 0 && !!b.url);
  if (buttons.length) a.buttons = buttons;

  // Drop undefined keys so they never reach Discord.
  return JSON.parse(JSON.stringify(a));
}

export class Presence {
  private client?: Client;
  private ready = false;
  private lastKey = "";
  connected = false;

  async connect(): Promise<void> {
    if (this.client) return;
    const c = new Client({ clientId: CLIENT_ID });
    c.on("ready", () => {
      this.ready = true;
      this.connected = true;
      this.lastKey = "";
    });
    c.on("disconnected", () => {
      this.ready = false;
      this.connected = false;
      this.client = undefined;
    });
    this.client = c;
    try {
      await c.login();
    } catch {
      this.client = undefined; // Discord not running, retry on next update
    }
  }

  async update(track: Track | null, info: TrackInfo, s: Settings): Promise<void> {
    if (!s.enabled || !track || (!track.playing && s.hideOnPause)) return this.clear();
    await this.connect();
    if (!this.ready || !this.client?.user) return;

    const a = buildActivity(track, info, s);
    // Re-send only when content changed or playback drifted (seek).
    const { startTimestamp, endTimestamp, ...rest } = a;
    const key = JSON.stringify(rest) + "|" + (startTimestamp ? Math.round(Number(startTimestamp) / 3000) : "");
    if (key === this.lastKey) return;
    this.lastKey = key;
    try {
      await this.client.user.setActivity(a);
    } catch {
      this.lastKey = ""; // retry on next tick
    }
  }

  async clear(): Promise<void> {
    if (!this.ready || !this.client?.user || this.lastKey === "") return;
    this.lastKey = "";
    try {
      await this.client.user.clearActivity();
    } catch {
      /* ignore */
    }
  }

  async destroy(): Promise<void> {
    try {
      await this.client?.destroy();
    } catch {
      /* ignore */
    }
  }
}
