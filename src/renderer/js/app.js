import { api, on } from "./api.js";
import { toast, modal, fmtDuration } from "./ui.js";
import { renderDashboard, refreshDashboard } from "./pages/dashboard.js";
import { renderCourses, refreshCourses, coursePageState } from "./pages/courses.js";
import { renderTasks, refreshTasks, updateTasksFromEvent } from "./pages/tasks.js";
import { renderAnswers, refreshAnswers } from "./pages/answers.js";
import { renderBrowser, onLeaveBrowser } from "./pages/browser.js";
import { renderSettings } from "./pages/settings.js";

/* ---------------- 全局状态 ---------------- */
export const state = {
  user: null,
  engine: "idle",
  settings: null,
  stats: null,
  riskMode: false,
};

const PAGES = {
  dashboard: { title: "仪表盘", render: renderDashboard, refresh: refreshDashboard },
  courses: { title: "课程中心", render: renderCourses, refresh: refreshCourses },
  tasks: { title: "任务队列", render: renderTasks, refresh: refreshTasks },
  answers: { title: "答题中心", render: renderAnswers, refresh: refreshAnswers },
  browser: { title: "辅助浏览器", render: renderBrowser },
  settings: { title: "设置", render: renderSettings },
};

let currentPage = "dashboard";

/* ---------------- 登录流程 ---------------- */

function renderLoginGate(container) {
  container.innerHTML = `
    <div class="login-wrap card">
      <div class="card-title">登录学习通 <span class="sub">使用手机学习通 App 扫码，无需输入密码</span></div>
      <div class="qr-box">
        <img id="qr-img" class="qr-img skeleton" alt="登录二维码" />
        <div class="qr-tip" id="qr-tip">正在获取二维码…</div>
        <div class="flex">
          <button class="btn btn-sm" id="btn-qr-refresh">刷新二维码</button>
          <button class="btn btn-sm" id="btn-pwd-login">账号密码登录</button>
        </div>
      </div>
    </div>`;
  const img = container.querySelector("#qr-img");
  const tip = container.querySelector("#qr-tip");
  let polling = false;

  async function loadQr() {
    tip.textContent = "正在获取二维码…";
    img.classList.add("skeleton");
    try {
      const { qrDataUrl } = await api.startQr();
      img.src = qrDataUrl;
      img.classList.remove("skeleton");
      tip.textContent = "请打开手机学习通 → 扫一扫，确认登录";
      startPolling();
    } catch (e) {
      tip.textContent = `二维码获取失败：${e.message}`;
    }
  }

  function stopPolling() { polling = false; }
  async function startPolling() {
    if (polling) return;
    polling = true;
    while (polling) {
      await new Promise((r) => setTimeout(r, 1200));
      if (!polling) break;
      try {
        const r = await api.pollQr();
        if (r.status === "scanned") tip.textContent = `已扫码（${r.nickname || "用户"}），请在手机上确认…`;
        else if (r.status === "expired") { tip.textContent = "二维码已过期，正在自动刷新…"; stopPolling(); setTimeout(loadQr, 800); }
        else if (r.status === "error") { tip.textContent = `错误：${r.message}`; stopPolling(); }
        else if (r.status === "success") { polling = false; onLoginSuccess(r.user); }
      } catch { /* 网络抖动继续轮询 */ }
    }
  }

  container.querySelector("#btn-qr-refresh").addEventListener("click", () => { stopPolling(); loadQr(); });
  container.querySelector("#btn-pwd-login").addEventListener("click", () => {
    stopPolling();
    const body = document.createElement("div");
    body.innerHTML = `
      <div class="setting-row"><div><div class="setting-label">账号</div></div><div class="setting-ctrl"><input id="lg-u" type="text" placeholder="手机号/超星号" style="width:200px"></div></div>
      <div class="setting-row"><div><div class="setting-label">密码</div></div><div class="setting-ctrl"><input id="lg-p" type="password" placeholder="学习通密码" style="width:200px"></div></div>
      <p class="small muted mt8">密码仅用于本机登录学习通，AES 加密传输，不做保存。</p>`;
    const close = modal({
      title: "账号密码登录",
      bodyHTML: body,
      actions: [
        { label: "取消" },
        {
          label: "登录",
          primary: true,
          onClick: async () => {
            const u = body.querySelector("#lg-u").value.trim();
            const p = body.querySelector("#lg-p").value;
            if (!u || !p) { toast("请输入账号密码", "warn"); return false; }
            try {
              const user = await api.loginPassword(u, p);
              onLoginSuccess(user);
            } catch (e) {
              toast(`登录失败：${e.message}`, "error");
              return false;
            }
          },
        },
      ],
    });
  });

  loadQr();
}

function onLoginSuccess(user) {
  state.user = user;
  toast(`欢迎，${user.name}（${user.schoolname || "学习通"}）`, "success");
  renderUserPanel();
  refreshDashboard();
  refreshCourses();
}

function renderUserPanel() {
  const panel = document.getElementById("sidebar-user");
  if (state.user) {
    panel.classList.remove("hidden");
    document.getElementById("user-name").textContent = state.user.name || "学习通用户";
    document.getElementById("user-school").textContent = state.user.schoolname || "";
    document.getElementById("user-avatar").textContent = (state.user.name || "?").slice(0, 1);
  } else {
    panel.classList.add("hidden");
  }
}

/* ---------------- 风险提示（首次启动） ---------------- */

function riskAckModal() {
  const settings = state.settings;
  if (settings.riskAck) return;
  modal({
    title: "使用前必读",
    bodyHTML: `
      <p><b>星跃</b>通过模拟学习通客户端请求自动完成任务点，<b>违反学习通用户协议，也可能违反你所在学校的校规</b>。可能的风险包括：任务进度清零、成绩无效、账号被限制。</p>
      <p class="mt8">为降低风险，星跃默认采用保守策略：低频率请求 + 随机节奏 + 单任务串行；不自动破解验证码；正式考试不代答不代交。</p>
      <p class="mt8">请仅用于<b>自己的账号</b>，并自行评估与承担使用后果。</p>`,
    actions: [
      {
        label: "我已知晓风险，继续使用",
        primary: true,
        onClick: async () => {
          state.settings = await api.setSettings({ riskAck: true });
        },
      },
    ],
    onClose: () => {},
  });
}

/* ---------------- 顶栏/状态 ---------------- */

function updateEngineUI() {
  const dot = document.getElementById("state-dot");
  const text = document.getElementById("state-text");
  const btn = document.getElementById("btn-queue-toggle");
  dot.className = "state-dot " + (state.engine === "running" ? "running" : state.engine === "paused" ? "paused" : "");
  text.textContent = state.engine === "running" ? "刷课中" : state.engine === "paused" ? "已暂停" : state.riskMode ? "待人工验证" : "空闲";
  btn.textContent = state.engine === "running" ? "暂停" : state.riskMode ? "继续（已过验证）" : "启动刷课";
  btn.classList.toggle("btn-primary", state.engine !== "running");
}

document.getElementById("btn-queue-toggle").addEventListener("click", async () => {
  if (state.engine === "running") {
    await api.queuePause();
  } else if (state.riskMode) {
    state.riskMode = false;
    await api.queueResumeAfterRisk();
  } else {
    try {
      await api.queueStart();
    } catch (e) {
      toast(e.message, "error");
    }
  }
});

/* ---------------- 路由 ---------------- */

function switchPage(name) {
  if (currentPage === "browser" && name !== "browser") onLeaveBrowser();
  currentPage = name;
  document.querySelectorAll(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.page === name));
  document.querySelectorAll(".page").forEach((el) => el.classList.remove("active"));
  document.getElementById(`page-${name}`).classList.add("active");
  document.getElementById("page-title").textContent = PAGES[name].title;
  PAGES[name].render(document.getElementById(`page-${name}`));
}

document.querySelectorAll(".nav-item").forEach((el) => {
  el.addEventListener("click", () => switchPage(el.dataset.page));
});

/* ---------------- 事件订阅 ---------------- */

on("auth-changed", (user) => {
  state.user = user;
  renderUserPanel();
  if (!user && currentPage === "courses") renderCourses(document.getElementById("page-courses"));
  refreshDashboard();
});

on("queue-event", (ev) => {
  if (ev.type === "state") {
    state.engine = ev.state;
    updateEngineUI();
    refreshTasks();
  } else if (ev.type === "task") {
    updateTasksFromEvent(ev.task);
    refreshDashboard();
  } else if (ev.type === "changed") {
    refreshTasks();
  } else if (ev.type === "stats") {
    state.stats = ev.stats;
    refreshDashboard();
  } else if (ev.type === "sheet") {
    refreshAnswers();
    toast("新答卷已生成，可在答题中心确认", "info");
  } else if (ev.type === "risk") {
    state.riskMode = true;
    updateEngineUI();
    toast(ev.message, "warn", 8000);
  } else if (ev.type === "log" && ev.level === "error") {
    toast(ev.message, "error");
  }
});

on("app-log", (entry) => {
  if (entry.scope === "risk" && entry.level === "warn") {
    // 风控日志已在 queue-event 处理
  }
});

on("sheets-updated", () => refreshAnswers());
on("stats-updated", (stats) => { state.stats = stats; refreshDashboard(); });

/* ---------------- 启动 ---------------- */

async function boot() {
  state.settings = await api.getSettings();
  state.stats = await api.getStats();
  const user = await api.getUser();
  if (user) {
    // 校验会话有效性
    api.checkSession().catch(() => undefined);
  }
  state.user = user;
  renderUserPanel();
  updateEngineUI();
  switchPage("dashboard");
  if (!user) {
    // 未登录：仪表盘显示登录卡片
    const container = document.getElementById("page-dashboard");
    renderLoginGate(container);
  } else {
    riskAckModal();
  }
}

window.__errors = [];
window.addEventListener("error", (e) => {
  window.__errors.push(String(e.message || e));
  console.error(e);
});
window.addEventListener("unhandledrejection", (e) => {
  window.__errors.push("unhandled: " + String(e.reason?.message || e.reason));
});

boot().catch((e) => {
  const c = document.getElementById("page-dashboard");
  if (c) c.innerHTML = `<div class="card" style="margin:40px auto;max-width:520px"><div class="card-title">启动失败</div><pre style="white-space:pre-wrap;user-select:text">${String(e.message || e)}</pre></div>`;
});
