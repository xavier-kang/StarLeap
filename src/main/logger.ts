import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

export type LogLevel = "debug" | "info" | "warn" | "error" | "success";

export interface LogEntry {
  ts: number;
  level: LogLevel;
  scope: string;
  message: string;
}

type Listener = (entry: LogEntry) => void;

const MAX_MEMORY = 2000;

class Logger {
  private listeners = new Set<Listener>();
  private ring: LogEntry[] = [];
  private stream: fs.WriteStream | null = null;

  constructor() {
    try {
      const dir = path.join(app.getPath("userData"), "logs");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `starleap-${new Date().toISOString().slice(0, 10)}.log`);
      this.stream = fs.createWriteStream(file, { flags: "a" });
    } catch {
      // 日志文件不可用时仅保留内存日志
    }
  }

  onLog(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recent(count = 300): LogEntry[] {
    return this.ring.slice(-count);
  }

  log(level: LogLevel, scope: string, message: string): void {
    const entry: LogEntry = { ts: Date.now(), level, scope, message };
    this.ring.push(entry);
    if (this.ring.length > MAX_MEMORY) this.ring.shift();
    const line = `${new Date(entry.ts).toLocaleTimeString("zh-CN")} [${level.toUpperCase()}] [${scope}] ${message}`;
    // eslint-disable-next-line no-console
    console.log(line);
    if (this.stream) this.stream.write(line + "\n");
    for (const l of this.listeners) {
      try {
        l(entry);
      } catch {
        // ignore listener errors
      }
    }
  }

  debug(scope: string, msg: string) { this.log("debug", scope, msg); }
  info(scope: string, msg: string) { this.log("info", scope, msg); }
  warn(scope: string, msg: string) { this.log("warn", scope, msg); }
  error(scope: string, msg: string) { this.log("error", scope, msg); }
  success(scope: string, msg: string) { this.log("success", scope, msg); }
}

export const logger = new Logger();
