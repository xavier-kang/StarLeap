import { app, BrowserWindow, ipcMain, Notification, WebContentsView } from "electron";
import * as path from "path";
import { JsonStore, Settings, DEFAULT_SETTINGS, Stats, DEFAULT_STATS, AnswerSheet, UserAccount } from "./store";
import { logger, LogEntry } from "./logger";
import { cx } from "./cx/client";
import { auth } from "./cx/auth";
import { courseApi, Course } from "./cx/courses";
import { TaskQueue, QueueEvent, TaskKind } from "./cx/queue";
import { submitSheet } from "./cx/quiz";
import { queryAnswer } from "./cx/tiku";
import { cacheSize } from "./cx/tiku";

/* ---------------- 全局状态 ---------------- */

const settingsStore = new JsonStore<Settings>("settings", DEFAULT_SETTINGS);
const statsStore = new JsonStore<Stats>("stats", DEFAULT_STATS);
const sheetsStore = new JsonStore<{ sheets: AnswerSheet[] }>("sheets", { sheets: [] });

let user: UserAccount | null = null;
let mainWindow: BrowserWindow | null = null;

/* ---------------- 内嵌辅助浏览器 ---------------- */

let assistView: WebContentsView | null = null;
let assistVisible = false;
let assistTop = 105; // 顶栏 52 + 页内工具条 53

function ensureAssist(): WebContentsView {
  if (assistView) return assistView;
  assistView = new WebContentsView({
    webPreferences: {
      partition: "persist:chaoxing",
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  assistView.webContents.setWindowOpenHandler(({ url }) => {
    assistView?.webContents.loadURL(url);
    return { action: "deny" };
  });
  assistView.webContents.on("did-navigate", pushAssistState);
  assistView.webContents.on("did-navigate-in-page", pushAssistState);
  assistView.webContents.on("page-title-updated", pushAssistState);
  return assistView;
}

function layoutAssist(): void {
  if (!mainWindow || !assistView) return;
  const { width, height } = mainWindow.getContentBounds();
  assistView.setBounds({ x: 0, y: assistTop, width, height: Math.max(0, height - assistTop) });
}

function showAssist(url?: string): void {
  if (!mainWindow) return;
  const view = ensureAssist();
  if (!assistVisible) {
    mainWindow.contentView.addChildView(view);
    assistVisible = true;
  }
  layoutAssist();
  view.setVisible(true);
  if (url) view.webContents.loadURL(url).catch(() => undefined);
  else if (view.webContents.getURL() === "") view.webContents.loadURL("https://i.chaoxing.com/").catch(() => undefined);
  pushAssistState();
}

function hideAssist(): void {
  if (!mainWindow || !assistView || !assistVisible) {
    pushAssistState();
    return;
  }
  mainWindow.contentView.removeChildView(assistView);
  assistVisible = false;
  pushAssistState();
}

function pushAssistState(): void {
  send("assist:state", {
    visible: assistVisible,
    url: assistView?.webContents.getURL() || "",
    title: assistView?.webContents.getTitle() || "",
  });
}

/* ---------------- 事件通道 ---------------- */

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function notify(title: string, body: string): void {
  if (!settingsStore.get("notifications")) return;
  try {
    new Notification({ title, body, silent: false }).show();
  } catch {
    /* ignore */
  }
}

/* ---------------- 队列组装 ---------------- */

function handleQueueEvent(ev: QueueEvent): void {
  send("queue-event", ev);
  if (ev.type === "task" && ev.task.kind === "video" && ev.task.status === "running") {
    const p = ev.task.progress;
    if (p.duration > 0) mainWindow?.setProgressBar(Math.min(1, p.seconds / p.duration));
    else mainWindow?.setProgressBar(2);
  } else if (ev.type === "state") {
    if (ev.state !== "running") mainWindow?.setProgressBar(-1);
  }
  if (ev.type === "task" && ev.task.status === "done") {
    const queued = queueSnapshot().tasks.filter((t) => t.status === "queued").length;
    app.dock?.setBadge(queued > 0 ? String(queued) : "");
    if (ev.task.kind !== "video") {
      notify("任务完成", `${ev.task.courseName} · ${ev.task.chapterTitle} → ${ev.task.message}`);
    }
  }
  if (ev.type === "risk") {
    notify("需要人工验证", ev.message);
    showAssist("https://mooc1.chaoxing.com/antispiderShowVerify.ac");
  }
}

const queue = new TaskQueue({
  getSettings: () => settingsStore.all,
  getStats: () => statsStore.all,
  updateStats: (mut) => {
    mut(statsStore.all);
    statsStore.persist();
    send("stats-updated", statsStore.all);
  },
  getSheets: () => sheetsStore.get("sheets"),
  saveSheet: (sheet) => {
    const sheets = sheetsStore.get("sheets").filter((s) => s.id !== sheet.id);
    sheets.unshift(sheet);
    sheetsStore.set("sheets", sheets.slice(0, 100));
    send("sheets-updated", sheetsStore.get("sheets"));
  },
  getUser: () => user,
  emit: handleQueueEvent,
  onRiskAssist: (message) => {
    logger.warn("risk", message);
  },
});

function queueSnapshot() {
  return queue.snapshot();
}

/* ---------------- App State（供托盘/菜单调用） ---------------- */

export const appState = {
  setWindow(w: BrowserWindow | null): void {
    mainWindow = w;
  },
  async startQueue(): Promise<void> {
    await queue.start();
  },
  pauseQueue(): void {
    queue.pause(true);
  },
  persistAll(): void {
    settingsStore.persistNow();
    statsStore.persistNow();
    sheetsStore.persistNow();
  },
};

/* ---------------- IPC ---------------- */

export function registerIpc(): void {
  const handle = (channel: string, fn: (...args: any[]) => Promise<any> | any) => {
    ipcMain.handle(channel, async (_e, ...args) => {
      try {
        return { ok: true, data: await fn(...args) };
      } catch (err: any) {
        logger.error("ipc", `${channel} 失败: ${err?.message || err}`);
        return { ok: false, error: String(err?.message || err) };
      }
    });
  };

  // 认证
  handle("auth:getUser", () => user);
  handle("auth:startQr", async () => {
    const qr = await auth.startQrLogin();
    return { qrDataUrl: qr.qrDataUrl };
  });
  handle("auth:pollQr", async () => {
    const r = await auth.pollQrLogin();
    if (r.status === "success") {
      user = r.user;
      send("auth-changed", user);
      notify("登录成功", `${r.user.name} · ${r.user.schoolname}`);
      logger.success("auth", `已登录: ${r.user.name}（${r.user.schoolname}）`);
    }
    return r;
  });
  handle("auth:loginPassword", async (uname: string, password: string) => {
    user = await auth.loginPassword(uname, password);
    send("auth-changed", user);
    return user;
  });
  handle("auth:logout", async () => {
    auth.cancelQr();
    user = null;
    await cx.clearSession();
    send("auth-changed", null);
    return true;
  });
  handle("auth:checkSession", async () => {
    user = await auth.fetchUserInfo();
    send("auth-changed", user);
    return user;
  });

  // 课程
  handle("courses:list", () => courseApi.listCourses());
  handle("chapters:list", async (course: Course) => {
    const chapters = await courseApi.listChapters(course);
    try {
      const ids = chapters.filter((c) => (c.jobCount || 0) > 0).map((c) => c.knowledgeId);
      const finishMap = await courseApi.getJobsFinishedMap(course, ids);
      for (const ch of chapters) {
        const f = finishMap[ch.knowledgeId];
        (ch as any).finished = f ? f.finished : 0;
        (ch as any).total = f ? f.total : ch.jobCount || 0;
      }
    } catch (e: any) {
      logger.warn("courses", `完成度查询失败（不影响使用）: ${e?.message || e}`);
    }
    return chapters;
  });
  handle("chapter:cards", (course: Course, knowledgeId: number) => courseApi.getChapterCards(course, knowledgeId));
  handle(
    "chapter:enqueue",
    async (course: Course, courseName: string, chapter: { knowledgeId: number; title: string }, kinds: TaskKind[]) => {
      const detail = await courseApi.getChapterCards(course, chapter.knowledgeId);
      const added = queue.enqueueFromCards(course, courseName, chapter, detail.cards, new Set(kinds));
      return { added };
    },
  );

  // 队列
  handle("queue:snapshot", () => queueSnapshot());
  handle("queue:start", () => appState.startQueue());
  handle("queue:pause", () => appState.pauseQueue());
  handle("queue:resumeAfterRisk", () => queue.resumeAfterRisk());
  handle("queue:removeTask", (id: string) => queue.removeTask(id));
  handle("queue:retryTask", (id: string) => queue.retryTask(id));
  handle("queue:clearFinished", () => queue.clearFinished());

  // 答题中心
  handle("sheets:list", () => sheetsStore.get("sheets"));
  handle(
    "sheets:submit",
    async (sheetId: string, answers: Record<string, string[]>, saveOnly: boolean) => {
      const sheets = sheetsStore.get("sheets");
      const sheet = sheets.find((s) => s.id === sheetId);
      if (!sheet) throw new Error("答卷不存在");
      for (const q of sheet.questions) {
        const override = answers[q.qid];
        if (override !== undefined) {
          q.answer = override.filter(Boolean);
          q.overridden = true;
          if (q.typeCode === 0 || q.typeCode === 1 || q.typeCode === 3) {
            q.answerText = q.answer.join("");
          } else {
            q.answerText = q.answer.join(" ");
          }
          q.source = "manual";
          q.confidence = 1;
        }
      }
      const result = await submitSheet(sheet, saveOnly);
      sheet.status = result.ok ? (saveOnly ? "saved" : "submitted") : "failed";
      sheet.note = result.message;
      sheetsStore.set("sheets", sheets);
      send("sheets-updated", sheets);
      return result;
    },
  );
  handle("sheets:regen", async (sheetId: string, qid: string) => {
    const sheets = sheetsStore.get("sheets");
    const sheet = sheets.find((s) => s.id === sheetId);
    if (!sheet) throw new Error("答卷不存在");
    const q = sheet.questions.find((x) => x.qid === qid);
    if (!q) throw new Error("题目不存在");
    const optTexts = q.options.map((o) => o.text);
    const r = await queryAnswer(
      { title: q.title, options: optTexts, typeCode: q.typeCode },
      { settings: settingsStore.all, subject: sheet.courseName },
    );
    if (!r) throw new Error("未获得答案");
    if (q.typeCode === 0 || q.typeCode === 1) {
      q.answer = r.values.map((l) => q.options[l.charCodeAt(0) - 65]?.value ?? l);
      q.answerText = r.values.join("");
    } else {
      q.answer = r.values;
      q.answerText = r.values.join(" ");
    }
    q.source = r.source;
    q.confidence = r.confidence;
    sheetsStore.set("sheets", sheets);
    send("sheets-updated", sheets);
    return q;
  });

  // 设置与统计
  handle("settings:get", () => settingsStore.all);
  handle("settings:set", (patch: Partial<Settings>) => {
    settingsStore.patch(patch);
    if (patch.launchAtLogin !== undefined) {
      app.setLoginItemSettings({ openAtLogin: patch.launchAtLogin });
    }
    return settingsStore.all;
  });
  handle("stats:get", () => statsStore.all);
  handle("logs:recent", () => logger.recent(300));

  // 辅助浏览器
  handle("assist:show", (url?: string) => {
    showAssist(url);
    return true;
  });
  handle("assist:hide", () => {
    hideAssist();
    return true;
  });
  handle("assist:navigate", (url: string) => {
    if (assistView) assistView.webContents.loadURL(url).catch(() => undefined);
    return true;
  });
  handle("assist:back", () => {
    assistView?.webContents.goBack();
    return true;
  });
  handle("assist:layout", (layout: { top: number }) => {
    assistTop = Math.max(52, Number(layout?.top) || 105);
    if (assistVisible) layoutAssist();
    return true;
  });
  handle("assist:state", () => ({ visible: assistVisible, url: assistView?.webContents.getURL() || "", title: assistView?.webContents.getTitle() || "" }));

  // 杂项
  handle("tiku:test", async (title: string) => {
    const r = await queryAnswer(
      { title: title || "大学的根本任务是立德树人", options: ["正确", "错误"], typeCode: 3 },
      { settings: settingsStore.all },
    );
    return r;
  });
  handle("app:info", () => ({
    version: app.getVersion(),
    platform: process.platform,
    cacheSize: cacheSize(),
  }));

  // 窗口拖拽区域配合（隐藏标题栏）
  ipcMain.on("window:minimize", () => mainWindow?.minimize());
  ipcMain.on("window:close", () => mainWindow?.close());

  // 启动时静默校验会话
  setTimeout(async () => {
    user = await auth.fetchUserInfo();
    send("auth-changed", user);
  }, 1200);

  logger.onLog((entry: LogEntry) => send("app-log", entry));
}

export function pushSheets(): void {
  send("sheets-updated", sheetsStore.get("sheets"));
}
