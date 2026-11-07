import { api } from "../api.js";
import { toast, fmtDuration } from "../ui.js";
import { state } from "../app.js";

export function renderSettings(el) {
  const s = state.settings;
  const st = state.stats;
  el.innerHTML = `
    <div class="grid grid-2">
      <div>
        <div class="card">
          <div class="card-title">视频刷课模式</div>
          <div class="setting-row">
            <div><div class="setting-label">模式</div><div class="setting-desc">标准=纯心跳模拟真实观看（推荐，进度按倍速推进）<br>稳妥=心跳+速度锁定1x（最稳）<br>极速=先尝试直接完成，被拒自动转心跳</div></div>
            <div class="setting-ctrl">
              <select id="s-video-mode">
                <option value="standard" ${s.videoMode === "standard" ? "selected" : ""}>标准（推荐）</option>
                <option value="safe" ${s.videoMode === "safe" ? "selected" : ""}>稳妥</option>
                <option value="flash" ${s.videoMode === "flash" ? "selected" : ""}>极速</option>
              </select>
            </div>
          </div>
          <div class="setting-row">
            <div><div class="setting-label">心跳推进倍速</div><div class="setting-desc">稳妥/标准回退模式下，播放进度的推进速度。2 表示以两倍速推进进度（总耗时减半）。过快存在风险。</div></div>
            <div class="setting-ctrl flex"><input type="range" id="s-speed" min="1" max="4" step="1" value="${s.videoSpeed}"><b id="s-speed-v" style="width:22px;text-align:right">${s.videoSpeed}x</b></div>
          </div>
          <div class="setting-row">
            <div><div class="setting-label">并发任务数</div><div class="setting-desc">同一时刻并行处理的任务数。1=串行（最稳）；2-3=多个视频同时推进（它们共享同一套限流节奏，请求总速率不变，风险可控）。</div></div>
            <div class="setting-ctrl"><select id="s-concurrency"><option value="1">1（推荐）</option><option value="2">2</option><option value="3">3</option></select></div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">测验策略</div>
          <div class="setting-row">
            <div><div class="setting-label">章节测验 / 作业</div><div class="setting-desc">交前确认=自动出答案，你在答题中心检查后提交（推荐）<br>全自动=答案覆盖≥60% 时直接提交<br>仅参考=只展示答案，不代填</div></div>
            <div class="setting-ctrl">
              <select id="s-quiz-policy">
                <option value="review" ${s.quizPolicy === "review" ? "selected" : ""}>自动作答 + 交前确认（推荐）</option>
                <option value="auto" ${s.quizPolicy === "auto" ? "selected" : ""}>全自动提交</option>
                <option value="reference" ${s.quizPolicy === "reference" ? "selected" : ""}>仅参考答案</option>
              </select>
            </div>
          </div>
          <div class="setting-row">
            <div><div class="setting-label">AI 未命中时蒙题</div><div class="setting-desc">题库和 AI 都没给出答案时，单选/判断题随机蒙一个（蒙题不缓存）。</div></div>
            <div class="setting-ctrl"><label class="switch"><input type="checkbox" id="s-guess" ${s.aiGuessOnMiss ? "checked" : ""}><span class="slider"></span></label></div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">调度与风控</div>
          <div class="setting-row">
            <div><div class="setting-label">App 参数实验（默认关）</div><div class="setting-desc">开启后视频上报附加 cxtime/cxcid 参数（对齐官方 App 请求形态）。服务端校验强度未证实，属实验功能；开启后日志带 [APP-EXP] 标记，若出现验证码/403 请立即关闭。</div></div>
            <div class="setting-ctrl"><label class="switch"><input type="checkbox" id="s-appexp" ${s.appParamExp ? "checked" : ""}><span class="slider"></span></label></div>
          </div>
          <div class="setting-row">
            <div><div class="setting-label">运行时段限制</div><div class="setting-desc">只在设定时段内运行，降低夜间集中请求的异常感。</div></div>
            <div class="setting-ctrl flex">
              <label class="switch"><input type="checkbox" id="s-window-on" ${s.timeWindowEnabled ? "checked" : ""}><span class="slider"></span></label>
              <input type="text" id="s-window" value="${s.timeWindow}" style="width:110px" placeholder="08:00-23:00">
            </div>
          </div>
          <div class="setting-row">
            <div><div class="setting-label">系统通知</div><div class="setting-desc">任务完成、需要人工验证时发送 macOS 通知。</div></div>
            <div class="setting-ctrl"><label class="switch"><input type="checkbox" id="s-notify" ${s.notifications ? "checked" : ""}><span class="slider"></span></label></div>
          </div>
          <div class="setting-row">
            <div><div class="setting-label">开机自启（后台）</div><div class="setting-desc">登录系统后自动在后台启动星跃。</div></div>
            <div class="setting-ctrl"><label class="switch"><input type="checkbox" id="s-autologin" ${s.launchAtLogin ? "checked" : ""}><span class="slider"></span></label></div>
          </div>
        </div>
      </div>

      <div>
        <div class="card">
          <div class="card-title">题库配置 <span class="sub">tikuAdapter 兼容</span></div>
          <div class="setting-row">
            <div><div class="setting-label">题库端点</div><div class="setting-desc">自建或第三方 tikuAdapter 服务地址，如 http://127.0.0.1:8060（留空则用内置免费源）。</div></div>
            <div class="setting-ctrl"><input type="text" id="s-tiku-endpoint" value="${s.tikuEndpoint}" placeholder="http://127.0.0.1:8060" style="width:200px"></div>
          </div>
          <div class="setting-row">
            <div><div class="setting-label">题库 Token</div><div class="setting-desc">部分题库需要 token，没有可留空。</div></div>
            <div class="setting-ctrl"><input type="text" id="s-tiku-token" value="${s.tikuToken}" placeholder="可留空" style="width:200px"></div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">AI 配置 <span class="sub">OpenAI 兼容接口</span></div>
          <div class="setting-row">
            <div><div class="setting-label">Base URL</div><div class="setting-desc">如 https://api.deepseek.com 或 https://dashscope.aliyuncs.com/compatible-mode/v1</div></div>
            <div class="setting-ctrl"><input type="text" id="s-ai-base" value="${s.aiBaseUrl}" placeholder="https://api.deepseek.com" style="width:210px"></div>
          </div>
          <div class="setting-row">
            <div><div class="setting-label">API Key</div><div class="setting-desc">仅保存在本机（userData/data/settings.json）。</div></div>
            <div class="setting-ctrl"><input type="password" id="s-ai-key" value="${s.aiApiKey}" placeholder="sk-..." style="width:210px"></div>
          </div>
          <div class="setting-row">
            <div><div class="setting-label">模型</div><div class="setting-desc">如 deepseek-chat、qwen-plus、gpt-4o-mini。</div></div>
            <div class="setting-ctrl"><input type="text" id="s-ai-model" value="${s.aiModel}" placeholder="deepseek-chat" style="width:210px"></div>
          </div>
          <div class="setting-row"><div class="setting-desc">配置后在「答题中心」点「测试答题源」验证。</div>
            <div class="setting-ctrl"><button class="btn btn-sm" id="btn-save-ai">保存题库/AI 配置</button></div></div>
        </div>

        <div class="card">
          <div class="card-title">账号与数据</div>
          <div class="setting-row">
            <div><div class="setting-label">当前账号</div><div class="setting-desc">${state.user ? `${state.user.name}（${state.user.schoolname || "学习通"}）· UID ${state.user.uid}` : "未登录"}</div></div>
            <div class="setting-ctrl"><button class="btn btn-sm btn-danger" id="btn-logout">退出登录</button></div>
          </div>
          <div class="setting-row">
            <div><div class="setting-label">答题缓存</div><div class="setting-desc">已答题目会缓存（避免重复请求题库/AI）。</div></div>
            <div class="setting-ctrl"><span class="muted small" id="cache-size">…</span></div>
          </div>
          <div class="setting-row">
            <div><div class="setting-label">累计成果</div><div class="setting-desc">${st ? `完成任务点 ${st.tasksDone} · 节省 ${fmtDuration(st.videoSeconds)}` : ""}</div></div>
            <div class="setting-ctrl"><span class="muted small">数据存于本机</span></div>
          </div>
        </div>

        <div class="card">
          <div class="card-title">关于</div>
          <div class="setting-desc" style="line-height:2">
            星跃 StarLeap v<span id="app-ver">…</span> · macOS<br>
            本工具仅供学习研究，自动化使用违反学习通用户协议，请自行承担风险。不自动破解验证码，正式考试仅提供人工辅助。
          </div>
        </div>
      </div>
    </div>
  `;

  const save = (patch) => api.setSettings(patch).then((r) => { state.settings = r; toast("设置已保存", "success"); }).catch((e) => toast(e.message, "error"));

  el.querySelector("#s-video-mode").addEventListener("change", (e) => save({ videoMode: e.target.value }));
  el.querySelector("#s-speed").addEventListener("input", (e) => {
    el.querySelector("#s-speed-v").textContent = e.target.value + "x";
  });
  el.querySelector("#s-speed").addEventListener("change", (e) => save({ videoSpeed: Number(e.target.value) }));
  el.querySelector("#s-concurrency").addEventListener("change", (e) => save({ concurrency: Number(e.target.value) }));
  el.querySelector("#s-quiz-policy").addEventListener("change", (e) => save({ quizPolicy: e.target.value }));
  el.querySelector("#s-guess").addEventListener("change", (e) => save({ aiGuessOnMiss: e.target.checked }));
  el.querySelector("#s-appexp").addEventListener("change", (e) => save({ appParamExp: e.target.checked }));
  el.querySelector("#s-window-on").addEventListener("change", (e) => save({ timeWindowEnabled: e.target.checked }));
  el.querySelector("#s-window").addEventListener("change", (e) => save({ timeWindow: e.target.value }));
  el.querySelector("#s-notify").addEventListener("change", (e) => save({ notifications: e.target.checked }));
  el.querySelector("#s-autologin").addEventListener("change", (e) => save({ launchAtLogin: e.target.checked }));
  el.querySelector("#btn-save-ai").addEventListener("click", () => {
    save({
      tikuEndpoint: el.querySelector("#s-tiku-endpoint").value.trim(),
      tikuToken: el.querySelector("#s-tiku-token").value.trim(),
      aiBaseUrl: el.querySelector("#s-ai-base").value.trim(),
      aiApiKey: el.querySelector("#s-ai-key").value.trim(),
      aiModel: el.querySelector("#s-ai-model").value.trim(),
    });
  });
  el.querySelector("#btn-logout").addEventListener("click", async () => {
    await api.logout();
    toast("已退出登录", "info");
    state.user = null;
  });
  api.appInfo().then((info) => {
    el.querySelector("#app-ver").textContent = info.version;
    el.querySelector("#cache-size").textContent = `${info.cacheSize} 题`;
  });
}
