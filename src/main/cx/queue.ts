import { Course, CardAttachment, CardInfo } from "./courses";
import { videoRunner, VideoMode } from "./video";
import { studyDocument, studyRead, studyBook } from "./document";
import { buildAnswerSheet, submitSheet } from "./quiz";
import { queryAnswer } from "./tiku";
import { Settings, Stats, AnswerSheet, UserAccount } from "../store";
import { logger } from "../logger";
import { cx } from "./client";

export type TaskKind = "video" | "document" | "read" | "book" | "quiz";
export type TaskStatus = "queued" | "running" | "done" | "failed" | "skipped" | "risk";

export interface Task {
  id: string;
  kind: TaskKind;
  course: Course;
  courseName: string;
  knowledgeId: number;
  chapterTitle: string;
  cardNum: number;
  att: CardAttachment;
  defaults: Record<string, any>;
  status: TaskStatus;
  progress: { seconds: number; duration: number };
  message: string;
  createdAt: number;
  finishedAt?: number;
  attempt?: number;
}

export type QueueEvent =
  | { type: "changed" }
  | { type: "task"; task: Task }
  | { type: "log"; level: string; scope: string; message: string }
  | { type: "stats"; stats: Stats }
  | { type: "sheet"; sheet: AnswerSheet }
  | { type: "state"; state: EngineState; message?: string }
  | { type: "risk"; message: string };

export type EngineState = "idle" | "running" | "paused";

interface QueueDeps {
  getSettings: () => Settings;
  getStats: () => Stats;
  updateStats: (mut: (s: Stats) => void) => void;
  getSheets: () => AnswerSheet[];
  saveSheet: (sheet: AnswerSheet) => void;
  getUser: () => UserAccount | null;
  emit: (ev: QueueEvent) => void;
  onRiskAssist: (message: string) => void;
}

function inTimeWindow(win: string, now = new Date()): boolean {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(win.trim());
  if (!m) return true;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = Number(m[1]) * 60 + Number(m[2]);
  const end = Number(m[3]) * 60 + Number(m[4]);
  if (start <= end) return minutes >= start && minutes <= end;
  return minutes >= start || minutes <= end; // 跨午夜
}

export class TaskQueue {
  private tasks: Task[] = [];
  private state: EngineState = "idle";
  private abortCurrent = false;
  private loopRunning = false;
  private riskPaused = false;
  private completedIds = new Set<string>();

  constructor(private deps: QueueDeps) {
    cx.onRisk = (info) => {
      if (this.state !== "running") return;
      logger.warn("risk", "检测到风控拦截，自动暂停任务队列");
      this.riskPaused = true;
      this.abortCurrent = true;
      this.deps.emit({ type: "risk", message: "请求被学习通风控拦截（403/验证码），已在辅助浏览器中打开验证页，请手动完成验证后点「继续」" });
      this.deps.onRiskAssist("学习通风控验证：请在辅助浏览器中完成滑块/验证码，然后回来点「继续运行」");
    };
  }

  /* ---------- 状态与数据 ---------- */

  snapshot(): { state: EngineState; tasks: Task[] } {
    return { state: this.state, tasks: this.tasks };
  }

  private touch(task: Task): void {
    this.deps.emit({ type: "task", task: { ...task } });
    this.deps.emit({ type: "changed" });
  }

  private log(level: "info" | "warn" | "error" | "success", scope: string, msg: string): void {
    logger.log(level, scope, msg);
    this.deps.emit({ type: "log", level, scope, message: msg });
  }

  /* ---------- 队列操作 ---------- */

  /** 从章节卡片构建任务并入队（去重） */
  enqueueFromCards(
    course: Course,
    courseName: string,
    chapter: { knowledgeId: number; title: string },
    cards: CardInfo[],
    kinds: Set<TaskKind>,
  ): number {
    let added = 0;
    for (const card of cards) {
      for (const att of card.attachments) {
        const kind = this.kindOf(att);
        if (!kind || !kinds.has(kind)) continue;
        if (!att.job) continue;
        const key = `${course.clazzId}:${chapter.knowledgeId}:${att.jobid}`;
        if (this.completedIds.has(key)) continue;
        if (this.tasks.some((t) => t.course.clazzId === course.clazzId && t.att.jobid === att.jobid && (t.status === "queued" || t.status === "running"))) continue;
        const task: Task = {
          id: `task-${Date.now()}-${Math.floor(Math.random() * 1e6)}-${added}`,
          kind,
          course,
          courseName,
          knowledgeId: chapter.knowledgeId,
          chapterTitle: chapter.title,
          cardNum: card.num,
          att,
          defaults: card.defaults,
          status: "queued",
          progress: { seconds: 0, duration: 0 },
          message: "排队中",
          createdAt: Date.now(),
        };
        this.tasks.push(task);
        added++;
      }
    }
    if (added > 0) {
      this.log("info", "queue", `已加入 ${added} 个任务（${courseName} · ${chapter.title}）`);
      this.deps.emit({ type: "changed" });
    }
    return added;
  }

  private kindOf(att: CardAttachment): TaskKind | null {
    if (att.type === "video") return "video";
    if (att.type === "document") return "document";
    if (att.type === "read") return "read";
    if (!att.type && att.property?.module === "insertbook" && att.job) return "book";
    if (att.type === "workid") return "quiz";
    return null;
  }

  removeTask(id: string): void {
    const t = this.tasks.find((x) => x.id === id);
    if (t && t.status === "running") this.abortCurrent = true;
    this.tasks = this.tasks.filter((x) => x.id !== id);
    this.deps.emit({ type: "changed" });
  }

  retryTask(id: string): void {
    const t = this.tasks.find((x) => x.id === id);
    if (!t || t.status === "running") return;
    t.status = "queued";
    t.message = "重新排队";
    t.attempt = (t.attempt || 0) + 1;
    this.deps.emit({ type: "changed" });
  }

  clearFinished(): void {
    this.tasks = this.tasks.filter((t) => t.status === "queued" || t.status === "running");
    this.deps.emit({ type: "changed" });
  }

  /* ---------- 启停控制 ---------- */

  async start(): Promise<void> {
    if (this.state === "running") return;
    if (!this.deps.getUser()) {
      this.log("warn", "queue", "尚未登录学习通账号");
      return;
    }
    this.riskPaused = false;
    this.state = "running";
    this.abortCurrent = false;
    this.deps.emit({ type: "state", state: this.state });
    this.log("success", "queue", "任务队列已启动");
    void this.runLoop();
  }

  pause(byUser = true): void {
    if (this.state !== "running") return;
    this.state = "paused";
    this.abortCurrent = true;
    this.deps.emit({ type: "state", state: this.state });
    this.log("info", "queue", byUser ? "已暂停" : "已自动暂停");
  }

  /** 风控恢复后继续 */
  async resumeAfterRisk(): Promise<void> {
    this.riskPaused = false;
    await this.start();
  }

  get isRiskPaused(): boolean {
    return this.riskPaused;
  }

  /* ---------- 主循环 ---------- */

  private async runLoop(): Promise<void> {
    if (this.loopRunning) return;
    this.loopRunning = true;
    try {
      while (this.state === "running") {
        const settings = this.deps.getSettings();
        if (settings.timeWindowEnabled && !inTimeWindow(settings.timeWindow)) {
          this.log("info", "queue", `当前不在运行时段（${settings.timeWindow}），等待中…`);
          await this.waitSeconds(60);
          continue;
        }
        // 风控暂停：等待用户处理
        if (this.riskPaused) {
          this.state = "paused";
          this.deps.emit({ type: "state", state: "paused" });
          break;
        }
        const next = this.tasks.find((t) => t.status === "queued");
        if (!next) {
          this.state = "idle";
          this.deps.emit({ type: "state", state: "idle" });
          this.log("success", "queue", "队列已全部处理完毕");
          break;
        }
        await this.runTask(next);
        // 任务间随机休眠，降低风险
        if (this.state === "running" && this.tasks.some((t) => t.status === "queued")) {
          await this.waitSeconds(3 + Math.random() * 5);
        }
      }
    } finally {
      this.loopRunning = false;
    }
  }

  private waitSeconds(sec: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setInterval(() => {
        if (this.state !== "running") {
          clearInterval(timer);
          resolve();
        }
      }, 1000);
      setTimeout(() => {
        clearInterval(timer);
        resolve();
      }, sec * 1000);
    });
  }

  private async runTask(task: Task): Promise<void> {
    task.status = "running";
    task.message = "开始处理";
    this.touch(task);
    const settings = this.deps.getSettings();
    try {
      switch (task.kind) {
        case "video":
          await this.runVideo(task, settings);
          break;
        case "document":
          await this.runSimple(task, "document");
          break;
        case "read":
          await this.runSimple(task, "read");
          break;
        case "book":
          await this.runSimple(task, "book");
          break;
        case "quiz":
          await this.runQuiz(task, settings);
          break;
      }
    } catch (e: any) {
      task.status = "failed";
      task.message = String(e?.message || e).slice(0, 200);
      task.finishedAt = Date.now();
      this.log("error", "queue", `任务失败: ${task.att.title} → ${task.message}`);
      this.touch(task);
    }
  }

  private abortChecker(): () => boolean {
    return () => this.abortCurrent || this.state !== "running";
  }

  private async runVideo(task: Task, settings: Settings): Promise<void> {
    this.log("info", "video", `开始: ${task.att.title}（${task.courseName} · ${task.chapterTitle}）`);
    const result = await videoRunner.run({
      course: task.course,
      knowledgeId: task.knowledgeId,
      defaults: task.defaults,
      att: task.att,
      mode: settings.videoMode as VideoMode,
      speed: Math.max(1, Math.min(8, settings.videoSpeed)),
      onProgress: (p) => {
        task.progress = { seconds: p.seconds, duration: p.duration };
        task.message = p.message;
        this.touch(task);
      },
      shouldAbort: this.abortChecker(),
    });
    if (this.abortCurrent && !result.passed) {
      task.status = "queued";
      task.message = "已暂停，等待继续";
      this.touch(task);
      return;
    }
    if (result.passed) {
      task.status = "done";
      task.message = result.message;
      task.finishedAt = Date.now();
      this.completedIds.add(`${task.course.clazzId}:${task.knowledgeId}:${task.att.jobid}`);
      this.log("success", "video", `完成: ${task.att.title}（${Math.round(result.durationSeconds / 60)} 分钟）`);
      this.deps.updateStats((s) => {
        s.tasksDone++;
        s.videosDone++;
        s.videoSeconds += Math.round(result.durationSeconds);
        this.bumpDaily(s, Math.round(result.durationSeconds));
      });
    } else {
      task.status = result.message.includes("风控") ? "risk" : "failed";
      task.message = result.message;
      task.finishedAt = Date.now();
      this.log("warn", "video", `未完成: ${task.att.title} → ${result.message}`);
    }
    this.touch(task);
  }

  private async runSimple(task: Task, kind: "document" | "read" | "book"): Promise<void> {
    let result;
    if (kind === "document") result = await studyDocument({ course: task.course, knowledgeId: task.knowledgeId, att: task.att });
    else if (kind === "read") result = await studyRead({ course: task.course, knowledgeId: task.knowledgeId, att: task.att });
    else result = await studyBook({ course: task.course, knowledgeId: task.knowledgeId, att: task.att });
    if (this.abortCurrent) {
      task.status = "queued";
      task.message = "已暂停";
      this.touch(task);
      return;
    }
    if (result.ok) {
      task.status = "done";
      task.finishedAt = Date.now();
      this.completedIds.add(`${task.course.clazzId}:${task.knowledgeId}:${task.att.jobid}`);
      this.deps.updateStats((s) => {
        s.tasksDone++;
        if (kind === "document" || kind === "book") s.documentsDone++;
        this.bumpDaily(s, 0);
      });
      this.log("success", kind, `完成: ${task.att.title}`);
    } else {
      task.status = "failed";
      task.message = result.message;
      task.finishedAt = Date.now();
      this.log("warn", kind, `未完成: ${task.att.title} → ${result.message}`);
    }
    this.touch(task);
  }

  private async runQuiz(task: Task, settings: Settings): Promise<void> {
    this.log("info", "quiz", `取题: ${task.chapterTitle}（${task.courseName}）`);
    const sheet = await buildAnswerSheet({
      course: task.course,
      courseName: task.courseName,
      chapterTitle: task.chapterTitle,
      knowledgeId: task.knowledgeId,
      defaults: task.defaults,
      att: task.att,
      settings,
    });
    this.deps.saveSheet(sheet);
    this.deps.emit({ type: "sheet", sheet });

    if (settings.quizPolicy === "reference") {
      task.status = "done";
      task.message = "已生成参考答案（仅参考模式）";
      task.finishedAt = Date.now();
      this.deps.updateStats((s) => {
        s.quizzesDone++;
        this.bumpDaily(s, 0);
      });
      this.touch(task);
      this.log("info", "quiz", `参考答案已生成: ${sheet.chapterTitle}（${sheet.questions.length} 题）`);
      return;
    }

    if (settings.quizPolicy === "review") {
      task.status = "done";
      task.message = "已自动作答，请在答题中心确认后提交";
      task.finishedAt = Date.now();
      this.deps.updateStats((s) => {
        s.quizzesDone++;
        this.bumpDaily(s, 0);
      });
      this.touch(task);
      this.log("success", "quiz", `答卷已生成待确认: ${sheet.chapterTitle}（${sheet.questions.length} 题）`);
      return;
    }

    // auto：全卷置信度达标才自动提交
    const answered = sheet.questions.filter((q) => q.source !== "none").length;
    const ratio = sheet.questions.length ? answered / sheet.questions.length : 0;
    if (ratio < 0.6) {
      task.status = "done";
      task.message = `答案覆盖率 ${(ratio * 100).toFixed(0)}% 不足 60%，已转人工确认`;
      task.finishedAt = Date.now();
      this.touch(task);
      this.log("warn", "quiz", `覆盖率不足，转人工: ${sheet.chapterTitle}`);
      return;
    }
    const r = await submitSheet(sheet, false);
    if (r.ok) {
      sheet.status = "submitted";
      task.status = "done";
      task.message = `已自动提交（${r.message}）`;
      this.log("success", "quiz", `自动提交成功: ${sheet.chapterTitle}`);
    } else {
      sheet.status = "failed";
      task.status = "failed";
      task.message = `自动提交失败: ${r.message}`;
      this.log("error", "quiz", `自动提交失败: ${sheet.chapterTitle} → ${r.message}`);
    }
    task.finishedAt = Date.now();
    this.deps.updateStats((s) => {
      s.quizzesDone++;
      this.bumpDaily(s, 0);
    });
    this.touch(task);
  }

  private bumpDaily(s: Stats, videoSeconds: number): void {
    const key = new Date().toISOString().slice(0, 10);
    const d = s.daily[key] || { tasksDone: 0, videoSeconds: 0, runSeconds: 0 };
    d.tasksDone++;
    d.videoSeconds += videoSeconds;
    s.daily[key] = d;
  }
}
