import { api } from "../api.js";
import { toast, escapeHtml, TYPE_TAG } from "../ui.js";
import { state } from "../app.js";

export const coursePageState = {
  course: null,
  chapters: [],
  kinds: new Set(["video", "document", "book", "quiz"]),
  selected: new Set(),
  enqueueing: false,
};

const KIND_LABEL = { video: "视频", document: "文档", book: "图书", quiz: "测验" };

export function renderCourses(el) {
  if (!state.user) {
    el.innerHTML = `<div class="empty"><div class="empty-ico">🔓</div>请先在仪表盘登录学习通</div>`;
    return;
  }
  if (coursePageState.course) {
    renderChapterView(el);
  } else {
    renderCourseGrid(el);
    refreshCourses();
  }
}

/* ---------- 课程列表 ---------- */

async function refreshCourseGrid(el) {
  const grid = el.querySelector("#course-grid");
  try {
    const courses = await api.listCourses();
    grid.innerHTML = courses
      .map(
        (c, i) => `
      <div class="course-card" data-i="${i}">
        <div class="course-cover"><div class="cover-name">${escapeHtml(c.name)}</div></div>
        <div class="course-teacher">
          <span>${escapeHtml(c.teacher || "教师未公开")}</span>
          <span class="muted">进入 →</span>
        </div>
      </div>`
      )
      .join("");
    grid.querySelectorAll(".course-card").forEach((card) => {
      card.addEventListener("click", () => openCourse(el, courses[Number(card.dataset.i)]));
    });
  } catch (e) {
    grid.innerHTML = `<div class="empty">加载失败：${escapeHtml(e.message)}</div>`;
  }
}

async function openCourse(el, course) {
  coursePageState.course = course;
  coursePageState.chapters = [];
  coursePageState.selected = new Set();
  renderChapterView(el, true);
  try {
    const chapters = await api.listChapters(course);
    coursePageState.chapters = chapters;
    renderChapterView(el);
  } catch (e) {
    toast(`章节加载失败：${e.message}`, "error");
    coursePageState.course = null;
    renderCourseGrid(el);
  }
}

/* ---------- 章节视图 ---------- */

function renderChapterView(el, loading = false) {
  const { course, chapters } = coursePageState;
  const kindChips = Object.entries(KIND_LABEL)
    .map(
      ([k, label]) =>
        `<button class="btn btn-sm kind-chip" data-kind="${k}" style="${coursePageState.kinds.has(k) ? "background:var(--accent-soft);border-color:var(--accent);color:var(--accent)" : ""}">${label}</button>`
    )
    .join("");

  el.innerHTML = `
    <div class="flex mb14" style="margin-bottom:14px">
      <button class="btn btn-sm" id="btn-back">← 返回课程列表</button>
      <b style="font-size:14px">${escapeHtml(course.name)}</b>
      <span class="muted small">${escapeHtml(course.teacher || "")}</span>
      <div style="margin-left:auto" class="flex">${kindChips}</div>
      <button class="btn btn-primary btn-sm" id="btn-enqueue" ${coursePageState.enqueueing ? "disabled" : ""}>加入队列</button>
    </div>
    <div class="risk-banner small">勾选章节后点「加入队列」——已选任务点类型：${[...coursePageState.kinds].map((k) => KIND_LABEL[k]).join("、") || "无"}。未完成的任务点会被自动处理。</div>
    ${
      loading
        ? `<div class="chapter-list">${Array.from({ length: 8 }).map(() => `<div class="chapter-row"><div class="skeleton" style="height:14px;width:70%"></div></div>`).join("")}</div>`
        : chapters.length
          ? `<div class="chapter-list" id="chapter-list"></div>`
          : `<div class="empty">未解析到章节（该课程可能没有章节内容）</div>`
    }
  `;
  el.querySelector("#btn-back").addEventListener("click", () => {
    coursePageState.course = null;
    renderCourseGrid(el);
    refreshCourses();
  });
  el.querySelectorAll(".kind-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const k = chip.dataset.kind;
      if (coursePageState.kinds.has(k)) coursePageState.kinds.delete(k);
      else coursePageState.kinds.add(k);
      renderChapterView(el);
    });
  });
  el.querySelector("#btn-enqueue").addEventListener("click", () => enqueueSelected(el));

  if (loading) return;
  const list = el.querySelector("#chapter-list");
  // 按单元分组
  const units = [];
  for (const ch of chapters) {
    let u = units[units.length - 1];
    if (!u || u.title !== ch.unit) {
      u = { title: ch.unit, items: [] };
      units.push(u);
    }
    u.items.push(ch);
  }
  for (const unit of units) {
    const head = document.createElement("div");
    head.className = "chapter-unit-head";
    head.textContent = unit.title;
    list.appendChild(head);
    for (const ch of unit.items) {
      const row = document.createElement("div");
      row.className = "chapter-row";
      const hasJob = (ch.jobCount || 0) > 0;
      const finished = ch.finished ?? 0;
      const total = ch.total ?? ch.jobCount ?? 0;
      const pct = total > 0 ? Math.min(100, Math.round((finished / total) * 100)) : (hasJob ? 0 : 100);
      row.innerHTML = `
        <input type="checkbox" class="chapter-check" ${hasJob && !ch.locked ? "" : "disabled"} />
        <span class="chapter-title" title="${escapeHtml(ch.title)}">${escapeHtml(ch.title)}</span>
        <div class="progress" style="width:110px"><div class="progress-bar" style="width:${pct}%"></div></div>
        <span class="muted small" style="width:56px;text-align:right">${finished}/${total}</span>
        ${ch.locked ? `<span class="tag tag-gray">未解锁</span>` : hasJob ? (pct >= 100 ? `<span class="tag tag-document">已完成</span>` : `<span class="tag tag-video">待刷 ${total - finished}</span>`) : `<span class="tag tag-gray">无任务</span>`}
      `;
      const cb = row.querySelector(".chapter-check");
      if (coursePageState.selected.has(ch.knowledgeId)) cb.checked = true;
      cb.addEventListener("change", () => {
        if (cb.checked) coursePageState.selected.add(ch.knowledgeId);
        else coursePageState.selected.delete(ch.knowledgeId);
      });
      list.appendChild(row);
    }
  }
}

async function enqueueSelected(el) {
  const { course, chapters, selected, kinds } = coursePageState;
  if (selected.size === 0) {
    toast("请先勾选要刷的章节", "warn");
    return;
  }
  if (kinds.size === 0) {
    toast("请至少选择一种任务点类型", "warn");
    return;
  }
  coursePageState.enqueueing = true;
  const btn = el.querySelector("#btn-enqueue");
  btn.disabled = true;
  btn.textContent = "正在解析任务点…";
  let total = 0;
  try {
    for (const kid of selected) {
      const ch = chapters.find((c) => c.knowledgeId === kid);
      if (!ch) continue;
      const { added } = await api.enqueue(course, course.name, { knowledgeId: ch.knowledgeId, title: ch.title }, [...kinds]);
      total += added;
    }
    toast(`已加入 ${total} 个任务，到「任务队列」启动`, "success", 4500);
    coursePageState.selected = new Set();
    renderChapterView(el);
  } catch (e) {
    toast(`入队失败：${e.message}`, "error");
  } finally {
    coursePageState.enqueueing = false;
  }
}

/* ---------- 对外刷新 ---------- */

export function renderCourseGrid(el) {
  el.innerHTML = `
    <div class="card-title" style="margin-bottom:14px">我的课程 <span class="sub">点击卡片进入章节</span></div>
    <div class="course-grid" id="course-grid"><div class="skeleton" style="height:150px"></div><div class="skeleton" style="height:150px"></div><div class="skeleton" style="height:150px"></div><div class="skeleton" style="height:150px"></div></div>
  `;
  refreshCourseGrid(el);
}

export function refreshCourses() {
  const el = document.getElementById("page-courses");
  if (el && el.classList.contains("active") && !coursePageState.course) renderCourseGrid(el);
}
