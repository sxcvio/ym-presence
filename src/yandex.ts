import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Track } from "./tracker";

export interface TrackInfo {
  cover?: string;
  url?: string;
}

export interface LookupOptions {
  /** Upload the cover Yandex Music gives to Windows to a temporary image host (Discord needs a URL). */
  uploadCovers: boolean;
}

interface Entry {
  info: TrackInfo;
  offer: (rank: number, cover?: string) => void;
  uploadStarted: boolean;
}
const cache = new Map<string, Entry>();
const uploaded = new Map<string, string>(); // file sha1 -> public url

const getJson = async (url: string, headers?: Record<string, string>): Promise<any> =>
  (await fetch(url, { headers, signal: AbortSignal.timeout(4000) })).json();

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const overlaps = (a: string, b: string) => a !== "" && b !== "" && (a.includes(b) || b.includes(a));

/** Guards against fuzzy search returning another artist's cover. */
function matches(t: Track, resTitle?: string, resArtist?: string): boolean {
  if (!resTitle || !resArtist) return false;
  if (!overlaps(norm(resTitle), norm(t.title))) return false;
  const ra = norm(resArtist);
  return t.artist.split(/[,&]/).some((a) => overlaps(ra, norm(a)));
}

async function upload(file: string): Promise<string | undefined> {
  const data = fs.readFileSync(file);
  const sha = crypto.createHash("sha1").update(data).digest("hex");
  const hit = uploaded.get(sha);
  if (hit) return hit;
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("time", "72h");
  form.append("fileToUpload", new Blob([data]), path.basename(file));
  const res = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  const url = (await res.text()).trim();
  if (!/^https:\/\/\S+$/.test(url)) return undefined;
  uploaded.set(sha, url);
  return url;
}

/** The Windows cover shows up a moment after the track itself, so this may run on a cache hit. */
function maybeUpload(e: Entry, t: Track, opts: LookupOptions): void {
  if (e.uploadStarted || !opts.uploadCovers || !t.thumb) return;
  e.uploadStarted = true;
  upload(t.thumb).then((u) => e.offer(1, u)).catch(() => {});
}

/**
 * Returns whatever is known about the track right away and fills the same object
 * in the background; `onDone` fires each time a better cover arrives so the caller can refresh.
 * Cover sources, best first: Yandex API (blocked outside RU) > Yandex cover from Windows
 * (uploaded, opt-in) > Deezer > iTunes.
 */
export function lookup(t: Track, opts: LookupOptions, onDone: () => void): TrackInfo {
  const key = `${t.artist}|${t.title}`;
  const hit = cache.get(key);
  if (hit) {
    maybeUpload(hit, t, opts);
    return hit.info;
  }

  const info: TrackInfo = {
    url: `https://music.yandex.ru/search?text=${encodeURIComponent(`${t.artist} ${t.title}`)}`,
  };
  let rank = 99;
  const offer = (r: number, cover?: string) => {
    if (!cover || r >= rank) return;
    rank = r;
    info.cover = cover;
    onDone();
  };
  const entry: Entry = { info, offer, uploadStarted: false };
  cache.set(key, entry);
  const term = encodeURIComponent(`${t.artist} ${t.title}`);

  getJson(`https://api.music.yandex.net/search?text=${term}&type=track&page=0`, {
    "X-Yandex-Music-Client": "YandexMusicAndroid/24023621",
  })
    .then((j) => {
      const r = j?.result?.tracks?.results?.[0];
      const albumId = r?.albums?.[0]?.id;
      if (albumId) info.url = `https://music.yandex.ru/album/${albumId}/track/${r.id}`;
      offer(0, r?.coverUri ? "https://" + String(r.coverUri).replace("%%", "400x400") : undefined);
    })
    .catch(() => {});

  maybeUpload(entry, t, opts);

  getJson(`https://api.deezer.com/search?q=${term}&limit=1`)
    .then((d) => {
      const r = d?.data?.[0];
      if (matches(t, r?.title, r?.artist?.name)) offer(2, r.album?.cover_big);
    })
    .catch(() => {});
  getJson(`https://itunes.apple.com/search?term=${term}&entity=song&limit=1`)
    .then((d) => {
      const r = d?.results?.[0];
      if (matches(t, r?.trackName, r?.artistName)) offer(3, String(r.artworkUrl100 ?? "").replace("100x100bb", "600x600bb") || undefined);
    })
    .catch(() => {});

  // Misses expire after a minute: sources may become reachable later (VPN off).
  setTimeout(() => {
    if (!info.cover && !entry.uploadStarted) cache.delete(key);
  }, 60_000);
  return info;
}
