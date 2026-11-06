import { api } from "../api.js";
import { fmtDuration } from "../ui.js";
import { state } from "../app.js";

export function renderDashboard(el) {
  const s = state.stats || { tasksDone: 0, videosDone: 0, videoSeconds: 0, documentsDone: 0, quizzesDone: 0, daily: {} };
  const todayKey = new Date().toISOString().slice(0, 10);
  const today = s.daily?.[todayKey] || { tasksDone: 0, videoSeconds: 0 };

  el.innerHTML = `
    ${state.user ? "" : loginHint()}
    <div class="grid grid-4">
      <div class="card stat-card"><div class="stat-value">${today.tasksDone}<span class="unit">个</span></div><div class="stat-label">今日完成任务点</div></div>
      <div class="card stat-card"><div class="stat-value">${fmtDuration(today.videoSeconds)}</div><div class="stat-label">今日节省时间</div></div>
      <div class="card stat-card"><div class="stat-value">${s.tasksDone || 0}<span class="unit">个</span></div><div class="stat-label">累计完成任务点</div></div>
      <div class="card stat-card"><div class="stat-value">${fmtDuration(s.videoSeconds || 0)}</div><div class="stat-label">累计节省时间</div></div>
    </div>

    <div class="grid grid-3 mt14">
      <div class="card stat-card"><div class="stat-value">${s.videosDone || 0}<span class="unit">个</span></div><div class="stat-label">完成视频</div></div>
      <div class="card stat-card"><div class="stat-value">${s.documentsDone || 0}<span class="unit">个</span></div><div class="stat-label">完成文档/图书</div></div>
      <div class="card stat-card"><div class="stat-value">${s.quizzesDone || 0}<span class="unit">份</span></div><div class="stat-label">处理测验</div></div>
    </div>

    <div class="card mt14">
      <div class="card-title">快速上手 <span class="sub">三步开始</span></div>
      <div style="line-height:2.1; font-size:12.5px; color: var(--text-2)">
        ① 在<b>课程中心</b>打开课程，勾选要刷的章节（任务点类型可筛选：视频/文档/测验）<br>
        ② 点击顶栏<b>「启动刷课」</b>，到<b>任务队列</b>看实时进度与日志<br>
        ③ 遇到<b>章节测验</b>时，去<b>答题中心</b>确认答案后提交（默认交前确认，可在设置改为全自动）<br>
        <span class="muted small">提示：风控验证码弹出时会自动暂停并通知你，到「辅助浏览器」完成滑块验证后点「继续」。</span>
      </div>
    </div>

    <div class="card mt14">
      <div class="card-title">运行日志 <span class="sub">最近 300 条</span></div>
      <div class="log-panel" id="dash-log">加载中…</div>
    </div>
  `;
  loadLogs(el.querySelector("#dash-log"));
}

function loginHint() {
  return `<div class="risk-banner">尚未登录学习通 —— 请先登录账号（右上角「设置」或重启应用后在仪表盘扫码）。<button class="btn btn-sm" onclick="location.reload()">刷新</button></div>`;
}

async function loadLogs(panel) {
  try {
    const logs = await api.recentLogs();
    panel.innerHTML = logs
      .slice(-300)
      .map(
        (l) =>
          `<div class="log-line"><span class="muted">${new Date(l.ts).toLocaleTimeString("zh-CN")}</span> <span class="lv lv-${l.level}">${l.level.toUpperCase()}</span> <span class="muted">[${l.scope}]</span> ${escapeLog(l.message)}</div>`
      )
      .join("") || '<span class="muted">暂无日志</span>';
    panel.scrollTop = panel.scrollHeight;
  } catch {
    panel.textContent = "日志加载失败";
  }
}

function escapeLog(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function refreshDashboard() {
  const el = document.getElementById("page-dashboard");
  if (el && el.classList.contains("active") && state.user) renderDashboard(el);
}
