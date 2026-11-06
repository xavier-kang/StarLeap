/** IPC 桥接封装 */
async function invoke(channel, ...args) {
  const res = await window.starleap.invoke(channel, ...args);
  if (!res || res.ok !== true) {
    throw new Error(res?.error || "未知错误");
  }
  return res.data;
}

export const api = {
  // 认证
  getUser: () => invoke("auth:getUser"),
  startQr: () => invoke("auth:startQr"),
  pollQr: () => invoke("auth:pollQr"),
  loginPassword: (u, p) => invoke("auth:loginPassword", u, p),
  logout: () => invoke("auth:logout"),
  checkSession: () => invoke("auth:checkSession"),
  // 课程
  listCourses: () => invoke("courses:list"),
  listChapters: (course) => invoke("chapters:list", course),
  chapterCards: (course, knowledgeId) => invoke("chapter:cards", course, knowledgeId),
  enqueue: (course, courseName, chapter, kinds) => invoke("chapter:enqueue", course, courseName, chapter, kinds),
  // 队列
  queueSnapshot: () => invoke("queue:snapshot"),
  queueStart: () => invoke("queue:start"),
  queuePause: () => invoke("queue:pause"),
  queueResumeAfterRisk: () => invoke("queue:resumeAfterRisk"),
  removeTask: (id) => invoke("queue:removeTask", id),
  retryTask: (id) => invoke("queue:retryTask", id),
  clearFinished: () => invoke("queue:clearFinished"),
  // 答题
  sheetsList: () => invoke("sheets:list"),
  sheetSubmit: (id, answers, saveOnly) => invoke("sheets:submit", id, answers, saveOnly),
  sheetRegen: (id, qid) => invoke("sheets:regen", id, qid),
  // 设置
  getSettings: () => invoke("settings:get"),
  setSettings: (patch) => invoke("settings:set", patch),
  getStats: () => invoke("stats:get"),
  recentLogs: () => invoke("logs:recent"),
  // 浏览器
  assistShow: (url) => invoke("assist:show", url),
  assistHide: () => invoke("assist:hide"),
  assistNavigate: (url) => invoke("assist:navigate", url),
  assistBack: () => invoke("assist:back"),
  assistState: () => invoke("assist:state"),
  tikuTest: (title) => invoke("tiku:test", title),
  appInfo: () => invoke("app:info"),
};

export function on(channel, cb) {
  return window.starleap.on(channel, cb);
}
