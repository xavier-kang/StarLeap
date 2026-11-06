import { api } from "../api.js";
import { escapeHtml, fmtDateTime, toast, modal } from "../ui.js";
import { state } from "../app.js";

let sheets = [];
let expandedId = null;
/** 用户在界面上的覆盖答案 sheetId -> qid -> value[] */
const overrides = new Map();

export function renderAnswers(el) {
  el.innerHTML = `
    <div class="flex" style="margin-bottom:14px">
      <span class="muted small">当前策略：<b>${policyLabel()}</b>（在设置中可改）</span>
      <span style="margin-left:auto"></span>
      <button class="btn btn-sm" id="btn-tiku-test">测试答题源</button>
    </div>
    <div id="sheet-list"></div>
  `;
  el.querySelector("#btn-tiku-test").addEventListener("click", tikuTest);
  renderSheetList();
  refreshAnswers();
}

function policyLabel() {
  const p = state.settings?.quizPolicy;
  return p === "auto" ? "全自动提交" : p === "reference" ? "仅参考答案" : "自动作答 + 交前确认";
}

function renderSheetList() {
  const list = document.getElementById("sheet-list");
  if (!list) return;
  if (!sheets.length) {
    list.innerHTML = `<div class="empty"><div class="empty-ico">📝</div>暂无答卷 —— 刷到章节测验时会自动出现在这里</div>`;
    return;
  }
  list.innerHTML = sheets
    .map((s) => {
      const answered = s.questions.filter((q) => q.source !== "none").length;
      const statusTag =
        s.status === "submitted"
          ? `<span class="tag tag-document">已提交</span>`
          : s.status === "saved"
            ? `<span class="tag tag-read">已保存</span>`
            : s.status === "failed"
              ? `<span class="tag tag-quiz">失败</span>`
              : `<span class="tag tag-video">待确认</span>`;
      return `
      <div class="sheet-card" data-id="${s.id}">
        <div class="sheet-head" data-act="toggle">
          <b>${escapeHtml(s.courseName)} · ${escapeHtml(s.chapterTitle)}</b>
          <span class="muted small">${s.questions.length} 题 · 已获答案 ${answered} · ${fmtDateTime(s.createdAt)}</span>
          ${statusTag}
          <span class="muted" style="margin-left:auto">${expandedId === s.id ? "▾" : "▸"}</span>
        </div>
        ${expandedId === s.id ? sheetBody(s) : ""}
      </div>`;
    })
    .join("");

  list.querySelectorAll('[data-act="toggle"]').forEach((h) =>
    h.addEventListener("click", () => {
      const id = h.closest(".sheet-card").dataset.id;
      expandedId = expandedId === id ? null : id;
      renderSheetList();
    }),
  );
  list.querySelectorAll("[data-act=submit]").forEach((b) =>
    b.addEventListener("click", () => doSubmit(b.dataset.id, false)),
  );
  list.querySelectorAll("[data-act=save]").forEach((b) =>
    b.addEventListener("click", () => doSubmit(b.dataset.id, true)),
  );
  list.querySelectorAll("[data-act=regen]").forEach((b) =>
    b.addEventListener("click", () => regen(b.dataset.id, b.dataset.qid)),
  );
  list.querySelectorAll(".q-option").forEach((opt) =>
    opt.addEventListener("click", () => toggleOption(opt)),
  );
  list.querySelectorAll(".q-answer-input").forEach((inp) =>
    inp.addEventListener("change", () => {
      const sheetId = inp.closest(".sheet-card").dataset.id;
      const qid = inp.dataset.qid;
      const vals = inp.value.split(/[#|]/).map((s) => s.trim()).filter(Boolean);
      setOverride(sheetId, qid, vals);
    }),
  );
}

function sheetBody(s) {
  const or = overrides.get(s.id) || {};
  return `
    <div class="sheet-body">
      ${s.note ? `<div class="risk-banner small">${escapeHtml(s.note)}</div>` : ""}
      ${s.questions
        .map((q, qi) => {
          const current = or[q.qid] ?? q.answer;
          const currentText = or[q.qid + ":text"] ?? q.answerText;
          const conf =
            q.source === "none"
              ? `<span class="conf-low">未获得答案</span>`
              : q.confidence >= 0.85
                ? `<span class="conf-high">${confLabel(q.source)} · 置信 ${(q.confidence * 100) | 0}%</span>`
                : `<span class="conf-mid">${confLabel(q.source)} · 置信 ${(q.confidence * 100) | 0}%</span>`;
          const selectedSet = new Set(current);
          return `
          <div class="q-row">
            <div class="q-title">${qi + 1}. ${escapeHtml(q.title || q.rawTitle || "(题目为空)")}</div>
            <div class="q-meta"><span>${typeName(q.typeCode)}</span>${conf}${q.overridden ? '<span class="tag tag-read">手动修改</span>' : ""}</div>
            ${
              q.typeCode === 0 || q.typeCode === 1
                ? `<div class="q-options">${q.options
                    .map(
                      (o) =>
                        `<div class="q-option ${selectedSet.has(o.value) ? "selected" : ""}" data-qid="${q.qid}" data-val="${escapeHtml(o.value)}">${escapeHtml(o.letter || "")}. ${escapeHtml(o.text)}</div>`
                    )
                    .join("")}</div>`
                : ""
            }
            <div class="q-answer-bar">
              <input class="q-answer-input" data-qid="${q.qid}" value="${escapeHtml(
                q.typeCode === 0 || q.typeCode === 1
                  ? current.map((v) => letterOf(q, v)).join("")
                  : currentText || "",
              )}" placeholder="${q.typeCode === 3 ? "正确 / 错误" : "填写答案（多空用#分隔）"}" />
              <button class="btn btn-sm" data-act="regen" data-id="${s.id}" data-qid="${q.qid}">重答</button>
            </div>
          </div>`;
        })
        .join("")}
      <div class="flex" style="justify-content:flex-end; margin-top:14px">
        <button class="btn" data-act="save" data-id="${s.id}">仅保存不提交</button>
        <button class="btn btn-primary" data-act="submit" data-id="${s.id}">确认并提交</button>
      </div>
    </div>`;
}

function letterOf(q, value) {
  const hit = q.options.find((o) => o.value === value);
  return hit ? hit.letter : value;
}

function confLabel(source) {
  return source === "tiku" ? "题库" : source === "ai" ? "AI" : source === "cache" ? "缓存" : source === "guess" ? "猜测" : source === "manual" ? "手动" : "无";
}

function typeName(code) {
  return ["单选题", "多选题", "填空题", "判断题", "简答题"][code] || "题目";
}

function setOverride(sheetId, qid, vals) {
  if (!overrides.has(sheetId)) overrides.set(sheetId, {});
  const or = overrides.get(sheetId);
  or[qid] = vals;
}

function toggleOption(optEl) {
  const sheetCard = optEl.closest(".sheet-card");
  const sheet = sheets.find((s) => s.id === sheetCard.dataset.id);
  const qid = optEl.dataset.qid;
  const val = optEl.dataset.val;
  const q = sheet.questions.find((x) => x.qid === qid);
  if (!q) return;
  const or = overrides.get(sheet.id) || {};
  let current = (or[qid] ?? q.answer).slice();
  if (q.typeCode === 1) {
    current = current.includes(val) ? current.filter((v) => v !== val) : [...current, val];
  } else {
    current = [val];
  }
  setOverride(sheet.id, qid, current);
  renderSheetList();
}

async function doSubmit(sheetId, saveOnly) {
  const sheet = sheets.find((s) => s.id === sheetId);
  if (!sheet) return;
  const answers = {};
  const or = overrides.get(sheetId) || {};
  for (const q of sheet.questions) {
    const v = or[q.qid];
    if (v !== undefined) {
      // 选择/判断用 value；填空/简答用文本
      if (q.typeCode === 0 || q.typeCode === 1 || q.typeCode === 3) answers[q.qid] = v;
      else answers[q.qid] = (or[q.qid + ":text"] ?? q.answerText ?? "").split(/[#|]/).map((x) => x.trim());
    }
  }
  if (!saveOnly) {
    const empty = sheet.questions.filter((q) => (answers[q.qid] ?? q.answer).filter(Boolean).length === 0).length;
    if (empty > 0 && !(await confirmEmpty(empty))) return;
  }
  try {
    const r = await api.sheetSubmit(sheetId, answers, saveOnly);
    if (r.ok) toast(saveOnly ? "已保存（未提交）" : `提交成功：${r.message}`, "success");
    else toast(`提交失败：${r.message}`, "error");
    refreshAnswers();
  } catch (e) {
    toast(e.message, "error");
  }
}

function confirmEmpty(n) {
  return new Promise((resolve) => {
    modal({
      title: "有未作答的题目",
      bodyHTML: `<p>还有 ${n} 题没有答案，提交后将保持空白。确定继续吗？</p>`,
      actions: [
        { label: "返回修改" },
        { label: "仍然提交", primary: true, onClick: () => resolve(true) },
      ],
      onClose: () => resolve(false),
    });
  });
}

async function regen(sheetId, qid) {
  try {
    const q = await api.sheetRegen(sheetId, qid);
    toast(`已重新作答（${confLabel(q.source)}）`, "success");
    refreshAnswers();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function tikuTest() {
  const close = modal({ title: "正在测试答题源…", bodyHTML: "<p>向题库/AI 发送一道测试判断题…</p>", actions: [{ label: "关闭" }] });
  try {
    const r = await api.tikuTest("");
    const bodyText = r
      ? `✅ 获得答案：<b>${escapeHtml(r.answerText)}</b>（来源：${confLabel(r.source)}，置信 ${(r.confidence * 100) | 0}%）<br><span class="muted small">说明题库或 AI 配置可用</span>`
      : `❌ 未获得答案。请检查设置中的「题库端点」或「AI 配置」。<br><span class="muted small">没有配置时，仍会用内置免费题库尝试（icodef）。</span>`;
    close();
    modal({ title: "答题源测试结果", bodyHTML: bodyText, actions: [{ label: "好的", primary: true }] });
  } catch (e) {
    close();
    modal({ title: "答题源测试失败", bodyHTML: escapeHtml(e.message), actions: [{ label: "好的" }] });
  }
}

export function refreshAnswers() {
  const el = document.getElementById("page-answers");
  if (!el || !el.classList.contains("active")) return;
  api
    .sheetsList()
    .then((list) => {
      sheets = list || [];
      const badge = document.getElementById("nav-answer-badge");
      const pending = sheets.filter((s) => s.status === "pending").length;
      badge.classList.toggle("hidden", pending === 0);
      badge.textContent = pending;
      renderSheetList();
    })
    .catch(() => undefined);
}
