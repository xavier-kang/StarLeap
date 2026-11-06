/* ---------- UI 工具：Toast / Modal / 格式化 ---------- */

export function toast(message, type = "info", duration = 3200) {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  document.getElementById("toast-container").appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity .3s, transform .3s";
    el.style.opacity = "0";
    el.style.transform = "translateX(24px)";
    setTimeout(() => el.remove(), 300);
  }, duration);
}

export function modal({ title, bodyHTML, actions = [], onClose }) {
  const root = document.getElementById("modal-root");
  root.classList.remove("hidden");
  root.innerHTML = "";
  const box = document.createElement("div");
  box.className = "modal";
  box.innerHTML = `<h2></h2><div class="modal-body"></div><div class="modal-actions"></div>`;
  box.querySelector("h2").textContent = title;
  const body = box.querySelector(".modal-body");
  if (typeof bodyHTML === "string") body.innerHTML = bodyHTML;
  else body.appendChild(bodyHTML);
  const actionsEl = box.querySelector(".modal-actions");
  for (const act of actions) {
    const btn = document.createElement("button");
    btn.className = `btn ${act.primary ? "btn-primary" : ""} ${act.danger ? "btn-danger" : ""}`;
    btn.textContent = act.label;
    btn.addEventListener("click", () => {
      const keep = act.onClick?.();
      if (keep !== false) close();
    });
    actionsEl.appendChild(btn);
  }
  root.appendChild(box);
  function close() {
    root.classList.add("hidden");
    root.innerHTML = "";
    onClose?.();
  }
  root.onclick = (e) => {
    if (e.target === root) close();
  };
  return close;
}

export function fmtDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分钟`;
  return `${s} 秒`;
}

export function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function fmtDateTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`;
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const TYPE_TAG = {
  video: { cls: "tag-video", text: "视频" },
  document: { cls: "tag-document", text: "文档" },
  read: { cls: "tag-read", text: "阅读" },
  book: { cls: "tag-book", text: "图书" },
  quiz: { cls: "tag-quiz", text: "测验" },
};

export const TASK_STATUS = {
  queued: { text: "排队中" },
  running: { text: "进行中" },
  done: { text: "完成" },
  failed: { text: "失败" },
  skipped: { text: "跳过" },
  risk: { text: "风控" },
};
