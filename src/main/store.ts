import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

/** 持久化 JSON 存储工具（带原子写入） */
export class JsonStore<T extends object> {
  private file: string;
  private data: T;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(name: string, defaults: T) {
    const dir = path.join(app.getPath("userData"), "data");
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, `${name}.json`);
    this.data = defaults;
    try {
      const raw = fs.readFileSync(this.file, "utf-8");
      const parsed = JSON.parse(raw);
      this.data = { ...defaults, ...parsed };
    } catch {
      this.persistNow();
    }
  }

  get all(): T {
    return this.data;
  }

  get<K extends keyof T>(key: K): T[K] {
    return this.data[key];
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    this.data[key] = value;
    this.persist();
  }

  patch(partial: Partial<T>): void {
    Object.assign(this.data, partial);
    this.persist();
  }

  /** 防抖持久化（500ms） */
  persist(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.persistNow(), 500);
  }

  persistNow(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf-8");
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error("[store] persist failed", err);
    }
  }
}

export interface Settings {
  /** 视频模式: safe=稳妥(纯心跳) | standard=标准(先秒过,失败回退心跳) | flash=极速(仅秒过) */
  videoMode: "safe" | "standard" | "flash";
  /** 心跳模式下播放进度推进倍速（1 = 与真实时间一致） */
  videoSpeed: number;
  /** 全局并发任务数（建议 1-2） */
  concurrency: number;
  /** 是否启用运行时段限制 */
  timeWindowEnabled: boolean;
  /** 运行时段 "HH:MM-HH:MM" */
  timeWindow: string;
  /** 测验策略: review=自动作答+交前确认 | auto=全自动提交 | reference=仅参考答案 */
  quizPolicy: "review" | "auto" | "reference";
  /** 题库配置（tikuAdapter 兼容端点） */
  tikuEndpoint: string;
  tikuToken: string;
  /** AI 配置（OpenAI 兼容） */
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  /** AI 未命中时是否蒙题（单选/判断） */
  aiGuessOnMiss: boolean;
  /** 实验性：视频上报附加 App 参数(cxtime/cxcid)，默认关 */
  appParamExp: boolean;
  /** 桌面通知 */
  notifications: boolean;
  /** 开机自启 */
  launchAtLogin: boolean;
  /** 已阅读并同意风险提示 */
  riskAck: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  videoMode: "standard",
  videoSpeed: 1,
  concurrency: 1,
  timeWindowEnabled: false,
  timeWindow: "08:00-23:00",
  quizPolicy: "review",
  tikuEndpoint: "",
  tikuToken: "",
  aiBaseUrl: "",
  aiApiKey: "",
  aiModel: "",
  aiGuessOnMiss: true,
  appParamExp: false,
  notifications: true,
  launchAtLogin: false,
  riskAck: false,
};

export interface Stats {
  /** 累计完成任务点 */
  tasksDone: number;
  /** 累计完成视频数 */
  videosDone: number;
  /** 累计视频时长（秒）——即"节省的时间" */
  videoSeconds: number;
  /** 累计文档数 */
  documentsDone: number;
  /** 累计测验处理数 */
  quizzesDone: number;
  /** 今日统计 {YYYY-MM-DD: {...}} */
  daily: Record<string, { tasksDone: number; videoSeconds: number; runSeconds: number }>;
}

export const DEFAULT_STATS: Stats = {
  tasksDone: 0,
  videosDone: 0,
  videoSeconds: 0,
  documentsDone: 0,
  quizzesDone: 0,
  daily: {},
};

/** 答题中心的答卷记录 */
export interface AnswerQuestion {
  qid: string;
  /** 0单选 1多选 2填空 3判断 4简答 */
  typeCode: number;
  /** 原始题干（可能含混淆字体） */
  rawTitle: string;
  /** 解密后的题干 */
  title: string;
  options: { letter: string; value: string; text: string }[];
  /** 题库/AI 给出的答案（value 数组） */
  answer: string[];
  answerText: string;
  /** 来源: tiku | ai | cache | none */
  source: string;
  /** 置信度 0-1 */
  confidence: number;
  /** 用户手动覆盖 */
  overridden?: boolean;
}

export interface AnswerSheet {
  id: string;
  courseId: number;
  clazzId: number;
  cpi: number;
  knowledgeId: number;
  workId: string;
  jobid: string;
  courseName: string;
  chapterTitle: string;
  /** hidden 表单字段（提交时回传） */
  formFields: Record<string, string>;
  questions: AnswerQuestion[];
  status: "pending" | "submitted" | "saved" | "failed";
  createdAt: number;
  note?: string;
}

export interface UserAccount {
  uid: string;
  name: string;
  schoolname: string;
  uname: string;
  fid: string;
}
