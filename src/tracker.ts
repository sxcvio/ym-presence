import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import readline from "readline";

export interface Track {
  title: string;
  artist: string;
  album: string;
  playing: boolean;
  position: number;
  duration: number;
  /** Path of the cover Yandex Music handed to Windows, if any. */
  thumb?: string;
}

export interface TrackerState {
  track: Track | null;
  sessions: string[];
}

/** Reads the Windows media session of Yandex Music through a PowerShell helper. */
export class Tracker extends EventEmitter {
  private proc?: ChildProcess;
  private stopped = false;

  constructor(private scriptPath: string) {
    super();
  }

  start(): void {
    this.stopped = false;
    this.proc = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", this.scriptPath], {
      windowsHide: true,
    });
    readline.createInterface({ input: this.proc.stdout! }).on("line", (line) => {
      try {
        const j = JSON.parse(line);
        const sessions: string[] = j.sessions ?? [];
        const track: Track | null = j.title
          ? {
              title: j.title,
              artist: j.artist ?? "",
              album: j.album ?? "",
              playing: j.status === "Playing",
              position: j.position ?? 0,
              duration: j.duration ?? 0,
              thumb: j.thumb ?? undefined,
            }
          : null;
        this.emit("state", { track, sessions } satisfies TrackerState);
      } catch {
        /* ignore malformed line */
      }
    });
    this.proc.on("exit", () => {
      if (!this.stopped) setTimeout(() => this.start(), 3000);
    });
  }

  stop(): void {
    this.stopped = true;
    this.proc?.kill();
  }
}
