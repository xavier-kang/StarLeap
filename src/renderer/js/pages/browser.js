import { api, on } from "../api.js";
import { escapeHtml, toast } from "../ui.js";

let urlInput = null;
let lastUrl = "https://i.chaoxing.com/";

export function renderBrowser(el) {
  el.style.display = "flex";
  el.style.flexDirection = "column";
  el.style.overflow = "hidden";
  el.style.padding = "0";
  el.innerHTML = `
    <div class="browser-bar" style="padding:10px 16px; border-bottom:1px solid var(--border); background:var(--bg-panel)">
      <button class="btn btn-sm" id="b-back">←</button>
      <input class="browser-url" id="b-url" type="text" placeholder="输入学习通地址，如 i.chaoxing.com" value="${escapeHtml(lastUrl)}" />
      <button class="btn btn-sm" id="b-go">前往</button>
      <button class="btn btn-sm" id="b-home">主页</button>
      <button class="btn btn-sm" id="b-close" title="退出内嵌浏览器">退出 ✕</button>
    </div>
    <div class="risk-banner small" style="margin:10px 16px 0">这里是内嵌的学习通页面（与刷课引擎共享登录态）。遇到<b>滑块验证码 / 人脸抽查</b>时，会自动打开对应页面 —— 人工完成验证后，回顶栏点「继续」。</div>
    <div class="browser-embedded" style="margin:10px 16px 16px; flex:1">
      <div class="browser-placeholder" id="b-placeholder">
        <div class="empty-ico">🌐</div>
        <div>内嵌浏览器就绪</div>
        <button class="btn btn-primary" id="b-open">打开学习通主页</button>
      </div>
    </div>
  `;
  urlInput = el.querySelector("#b-url");
  el.querySelector("#b-back").addEventListener("click", () => api.assistBack());
  el.querySelector("#b-go").addEventListener("click", go);
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
  });
  el.querySelector("#b-home").addEventListener("click", () => navigate("https://i.chaoxing.com/"));
  el.querySelector("#b-close").addEventListener("click", () => {
    api.assistHide().catch(() => undefined);
    document.querySelector('[data-page="dashboard"]')?.click();
  });
  el.querySelector("#b-open").addEventListener("click", () => navigate("https://i.chaoxing.com/"));

  // 布局与显示
  layoutAssist();
  api.assistShow().catch(() => undefined);

  if (!renderBrowser.__stateHooked) {
    renderBrowser.__stateHooked = true;
  on("assist:state", (st) => {
    const ph = el.querySelector("#b-placeholder");
    if (ph) ph.style.display = st.visible && st.url ? "none" : "flex";
    if (st.url && document.activeElement !== urlInput) urlInput.value = st.url;
    if (st.url) lastUrl = st.url;
  });
  api.assistState().then((st) => {
    const ph = el.querySelector("#b-placeholder");
    if (ph && st.visible && st.url) ph.style.display = "none";
    if (st.url) {
      urlInput.value = st.url;
      lastUrl = st.url;
    }
  });
  }
}

function layoutAssist() {
  // 顶栏 52 + 浏览器工具条 53 ≈ 105
  window.starleap.invoke("assist:layout", { top: 105 });
}

function go() {
  let v = urlInput.value.trim();
  if (!v) return;
  if (!/^https?:\/\//.test(v)) {
    v = v.includes(".") ? `https://${v}` : `https://i.chaoxing.com/search?val=${encodeURIComponent(v)}`;
  }
  navigate(v);
}

function navigate(url) {
  lastUrl = url;
  urlInput.value = url;
  api.assistNavigate(url).catch((e) => toast(e.message, "error"));
}

export function onLeaveBrowser() {
  api.assistHide().catch(() => undefined);
  // renderBrowser 在页面根元素上设置过内联 display:flex，必须清除，
  // 否则内联样式压过 .page 的 display:none，整页 DOM 会一直盖在其它页面上
  const el = document.getElementById("page-browser");
  if (el) {
    el.style.display = "";
    el.style.overflow = "";
    el.style.padding = "";
  }
}
