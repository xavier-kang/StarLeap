import { cx } from "./client";
import { Course, CardAttachment } from "./courses";
import { logger } from "../logger";

export interface SimpleJobInput {
  course: Course;
  knowledgeId: number;
  att: CardAttachment;
}

export interface SimpleJobResult {
  ok: boolean;
  message: string;
}

/** 文档任务点（ppt/doc/pdf）阅读完成上报 */
export async function studyDocument(input: SimpleJobInput): Promise<SimpleJobResult> {
  const { course, knowledgeId, att } = input;
  if (!att.jtoken) return { ok: false, message: "缺少 jtoken" };
  const params = new URLSearchParams({
    jobid: att.jobid,
    knowledgeid: String(knowledgeId),
    courseid: String(course.courseId),
    clazzid: String(course.clazzId),
    jtoken: att.jtoken,
    _dc: String(Date.now()),
  });
  const res = await cx.fetch(`https://mooc1.chaoxing.com/ananas/job/document?${params.toString()}`);
  if (res.status !== 200) return { ok: false, message: `上报失败 HTTP ${res.status}` };
  let ok = true;
  try {
    const body = await res.json();
    ok = body?.status !== false;
  } catch {
    /* 非 JSON 也视为成功 */
  }
  logger.info("document", `文档上报: ${att.title} → ${ok ? "成功" : "未确认"}`);
  return { ok, message: ok ? "阅读完成" : "服务端未确认" };
}

/** 阅读类任务点（readv2） */
export async function studyRead(input: SimpleJobInput): Promise<SimpleJobResult> {
  const { course, knowledgeId, att } = input;
  const params = new URLSearchParams({
    jobid: att.jobid,
    knowledgeid: String(knowledgeId),
    jtoken: att.jtoken || "",
    courseid: String(course.courseId),
    clazzid: String(course.clazzId),
  });
  const res = await cx.fetch(`https://mooc1.chaoxing.com/ananas/job/readv2?${params.toString()}`);
  if (res.status !== 200) return { ok: false, message: `上报失败 HTTP ${res.status}` };
  let ok = true;
  try {
    const body = await res.json();
    ok = body?.status !== false;
  } catch {
    /* ignore */
  }
  logger.info("read", `阅读上报: ${att.title} → ${ok ? "成功" : "未确认"}`);
  return { ok, message: ok ? "阅读完成" : "服务端未确认" };
}

/** 图书阅读任务（insertbook）——阅读页面上报 */
export async function studyBook(input: SimpleJobInput): Promise<SimpleJobResult> {
  // 图书任务的完成依赖阅读器心跳，此处先尝试 readv2 上报；若服务端不认可则报告为需人工
  const r = await studyRead(input);
  return r.ok ? r : { ok: false, message: "图书任务暂不支持自动完成，请到辅助浏览器手动翻阅" };
}
