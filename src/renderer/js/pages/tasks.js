import { api, on } from "../api.js";
import { escapeHtml, TASK_STATUS, TYPE_TAG, fmtTime } from "../ui.js";
import { state } from "../app.js";

let tasksCache = [];
let engineState = "idle";
let logsCache = [];

export function renderTasks(el) {
  el.innerHTML = `
    <div class="flex" style="margin-bottom:14px">
      <span id="q-state" class="tag tag-gray">空闲</span>
      <button class="btn btn-sm" id="btn-clear">清除已完成</button>
      ${state.riskMode ? `<button class="btn btn-sm btn-primary" id="btn-resume">已过验证，继续运行</button>` : ""}
      <span class="muted small" style="margin-left:auto">并发与模式在「设置」中调整 · 视频默认串行最稳</span>
    </div>
    <div class="card" style="padding:6px 14px">
      <div id="task-list"></div>
    </div>
    <div class="card mt14">
      <div class="card-title">实时日志 <span class="sub">滚动自动跟随</span></div>
      <div class="log-panel" id="task-log" style="height:300px"></div>
    </div>
  `;
  el.querySelector("#btn-clear").addEventListener("click", async () => {
    await api.clearFinished();
    refreshTasks();
  });
  const resumeBtn = el.querySelector("#btn-resume");
  if (resumeBtn) {
    resumeBtn.addEventListener("click", async () => {
      state.riskMode = false;
      await api.queueResumeAfterRisk();
    });
  }
  renderTaskList();
  renderLogPanel();
  refreshTasks();
  on("app-log", (entry) => {
    logsCache.push(entry);
    if (logsCache.length > 400) logsCache.shift();
    renderLogPanel();
  });
}

function renderTaskList() {
  const list = document.getElementById("task-list");
  if (!list) return;
  if (tasksCache.length === 0) {
    list.innerHTML = `<div class="empty"><div class="empty-ico">📭</div>队列是空的 —— 去课程中心勾选章节加入任务</div>`;
    return;
  }
  list.innerHTML = tasksCache
    .slice()
    .reverse()
    .map((t) => {
      const tag = TYPE_TAG[t.kind] || { cls: "tag-gray", text: t.kind };
      const st = TASK_STATUS[t.status] || { text: t.status };
      const pct = t.progress.duration > 0 ? Math.round((t.progress.seconds / t.progress.duration) * 100) : 0;
      return `
      <div class="task-row" data-id="${t.id}">
        <span class="task-status-dot ${t.status}"></span>
        <div class="task-main">
          <div class="task-name">${escapeHtml(t.att.title || "(未命名)")}</div>
          <div class="task-sub">${escapeHtml(t.courseName)} · ${escapeHtml(t.chapterTitle)} · ${fmtTime(t.createdAt)}</div>
          ${
            t.kind === "video" && t.status === "running" && t.progress.duration > 0
              ? `<div class="progress mt8" style="margin-top:6px"><div class="progress-bar" style="width:${pct}%"></div></div>`
              : ""
          }
        </div>
        <span class="tag ${tag.cls}">${tag.text}</span>
        <span class="small ${t.status === "done" ? "conf-high" : t.status === "failed" || t.status === "risk" ? "conf-low" : "muted"}" style="width:180px;text-align:right">${escapeHtml(t.message || st.text)}</span>
        ${
          t.status === "running" || t.status === "queued"
            ? `<button class="btn btn-sm" data-act="skip">跳过</button>`
            : t.status !== "done"
              ? `<button class="btn btn-sm" data-act="retry">重试</button>`
              : ""
        }
      </div>`;
    })
    .join("");
  list.querySelectorAll('[data-act="skip"]').forEach((b) =>
    b.addEventListener("click", () => api.removeTask(b.closest(".task-row").dataset.id)),
  );
  list.querySelectorAll('[data-act="retry"]').forEach((b) =>
    b.addEventListener("click", () => api.retryTask(b.closest(".task-row").dataset.id)),
  );
}

function renderLogPanel() {
  const panel = document.getElementById("task-log");
  if (!panel) return;
  const atBottom = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 40;
  panel.innerHTML = logsCache
    .slice(-300)
    .map(
      (l) =>
        `<div class="log-line"><span class="muted">${new Date(l.ts).toLocaleTimeString("zh-CN")}</span> <span class="lv lv-${l.level}">${l.level.toUpperCase()}</span> <span class="muted">[${l.scope}]</span> ${escapeHtml(l.message)}</div>`
    )
    .join("");
  if (atBottom) panel.scrollTop = panel.scrollHeight;
}

export function updateTasksFromEvent(task) {
  const i = tasksCache.findIndex((t) => t.id === task.id);
  if (i >= 0) tasksCache[i] = task;
  else tasksCache.push(task);
  renderTaskList();
}

export function refreshTasks() {
  const el = document.getElementById("page-tasks");
  if (!el || !el.classList.contains("active")) return;
  api
    .queueSnapshot()
    .then(({ state: st, tasks }) => {
      engineState = st;
      tasksCache = tasks;
      const badge = document.getElementById("q-state");
      if (badge) {
        badge.textContent = st === "running" ? "运行中" : st === "paused" ? "已暂停" : "空闲";
        badge.className = `tag ${st === "running" ? "tag-document" : "tag-gray"}`;
      }
      renderTaskList();
    })
    .catch(() => undefined);
}
