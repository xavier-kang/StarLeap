import { session, Session } from "electron";
import { logger } from "../logger";

/** 学习通会话分区名（持久化 cookie） */
export const CX_PARTITION = "persist:chaoxing";

export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const VIDEO_REFERER =
  "https://mooc1.chaoxing.com/ananas/modules/video/index.html?v=2026-1106-1930";
export const AUDIO_REFERER =
  "https://mooc1.chaoxing.com/ananas/modules/audio/index_new.html?v=2026-1106-1930";

export interface FetchOptions {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string | URLSearchParams;
  /** 是否绕过全局限流（内部极少用） */
  raw?: boolean;
}

export type RiskHandler = (info: { url: string; status: number; body: string }) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 全局请求节流器：串行化并保证最小间隔 + 随机抖动，模拟人工节奏 */
class RateLimiter {
  private chain: Promise<void> = Promise.resolve();
  constructor(private minGapMs: number, private jitterMs: number) {}
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.chain.then(async () => {
      const value = await fn();
      const gap = this.minGapMs + Math.random() * this.jitterMs;
      await sleep(gap);
      return value;
    });
    // 失败不应阻塞后续请求
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export class CxClient {
  /** 普通接口限流：0.4s + 0~0.5s 抖动 */
  private limiter = new RateLimiter(400, 500);
  /** 视频上报限流：2s + 0~2s 抖动 */
  videoLimiter = new RateLimiter(2000, 2000);
  onRisk: RiskHandler | null = null;
  private _ses: Session | null = null;

  /** 惰性获取会话（session 仅在 app ready 后可用） */
  get ses(): Session {
    if (!this._ses) {
      this._ses = session.fromPartition(CX_PARTITION);
    }
    return this._ses;
  }

  setUserAgent(ua: string): void {
    this.ses.setUserAgent(ua);
  }

  async fetchJson<T = any>(url: string, opts: FetchOptions = {}): Promise<T> {
    const res = await this.fetch(url, opts);
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`非 JSON 响应 (${res.status}): ${text.slice(0, 160)}`);
    }
  }

  async fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
    const res = await this.fetch(url, opts);
    return res.text();
  }

  /** 带限流与风控检测的请求 */
  async fetch(url: string, opts: FetchOptions = {}): Promise<Response> {
    const doFetch = async (): Promise<Response> => {
      const headers: Record<string, string> = {
        "User-Agent": UA,
        "Accept-Language": "zh-CN,zh;q=0.9",
        ...(opts.headers || {}),
      };
      const init: RequestInit & { body?: string } = {
        method: opts.method || "GET",
        headers,
      };
      if (opts.body) {
        init.body = typeof opts.body === "string" ? opts.body : opts.body.toString();
        if (!headers["Content-Type"]) headers["Content-Type"] = "application/x-www-form-urlencoded";
      }
      return this.ses.fetch(url, init as any);
    };

    const res = opts.raw ? await doFetch() : await this.limiter.run(doFetch);
    await this.detectRisk(url, res);
    return res;
  }

  /** 视频上报专用（独立限流节奏） */
  async fetchVideo(url: string, opts: FetchOptions = {}): Promise<Response> {
    const res = await this.videoLimiter.run(() =>
      this.ses.fetch(url, {
        method: opts.method || "GET",
        headers: { "User-Agent": UA, ...(opts.headers || {}) } as any,
        body: opts.body ? String(opts.body) : undefined,
      } as any),
    );
    await this.detectRisk(url, res);
    return res;
  }

  private async detectRisk(url: string, res: Response): Promise<void> {
    if (res.status !== 403) return;
    let body = "";
    try {
      body = (await res.clone().text()).slice(0, 400);
    } catch {
      /* ignore */
    }
    logger.warn("risk", `请求被拦截(403): ${url.slice(0, 90)} ${body.slice(0, 80)}`);
    this.onRisk?.({ url, status: res.status, body });
  }

  /** 读取当前会话的某个 cookie 值 */
  async cookie(name: string, domain = "chaoxing.com"): Promise<string | null> {
    const cookies = await this.ses.cookies.get({ domain });
    const hit = cookies.find((c) => c.name === name);
    return hit ? hit.value : null;
  }

  async getUid(): Promise<string> {
    return (await this.cookie("_uid")) || (await this.cookie("UID")) || "";
  }

  async getFid(): Promise<string> {
    return (await this.cookie("fid")) || "";
  }

  async clearSession(): Promise<void> {
    await this.ses.clearStorageData();
  }
}

export const cx = new CxClient();
