import * as fs from "fs";
import * as path from "path";
import { cx } from "./client";
import { Course, CardAttachment } from "./courses";
import { logger } from "../logger";
import { AnswerQuestion, AnswerSheet } from "../store";
import { queryAnswer, judgeNormalize } from "./tiku";
import { Settings } from "../store";

export interface ParsedOption {
  letter: string;
  value: string;
  text: string;
}

export interface ParsedQuestion {
  qid: string;
  typeCode: number;
  rawTitle: string;
  title: string;
  options: ParsedOption[];
}

export interface ParsedWork {
  fields: Record<string, string>;
  questions: ParsedQuestion[];
  answeredBefore: boolean;
  rawHtml: string;
}

/* ---------------- cxsecret 混淆字体解密 ---------------- */

let secretMap: Record<string, string> | null = null;
let secretMapLoaded = false;

function loadSecretMap(): Record<string, string> {
  if (secretMapLoaded) return secretMap || {};
  secretMapLoaded = true;
  const candidates = [
    path.join(process.resourcesPath || "", "cxsecret-map.json"),
    path.join(__dirname, "../../../resources/cxsecret-map.json"),
    path.join(__dirname, "../../resources/cxsecret-map.json"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        secretMap = JSON.parse(fs.readFileSync(p, "utf-8"));
        logger.info("quiz", `混淆字体映射表已加载（${Object.keys(secretMap!).length} 字）`);
        return secretMap!;
      }
    } catch {
      /* try next */
    }
  }
  logger.warn("quiz", "未找到 cxsecret 映射表，题干可能显示为乱码");
  return {};
}

export function decryptSecretText(text: string): string {
  const map = loadSecretMap();
  if (!text || Object.keys(map).length === 0) return text;
  let out = "";
  for (const ch of text) out += map[ch] || ch;
  return out;
}

export function hasSecretMap(): boolean {
  return Object.keys(loadSecretMap()).length > 0;
}

/* ---------------- 取题与解析 ---------------- */

const stripTags = (s: string) =>
  s
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .trim();

export async function fetchWorkPage(
  course: Course,
  knowledgeId: number,
  defaults: Record<string, any>,
  att: CardAttachment,
): Promise<ParsedWork> {
  const workId = att.jobid.replace(/^work-/, "");
  const params = new URLSearchParams({
    api: "1",
    workId,
    jobid: att.jobid,
    originJobId: att.jobid,
    needRedirect: "true",
    skipHeader: "true",
    knowledgeid: String(knowledgeId),
    ktoken: String(defaults.ktoken || ""),
    cpi: String(course.cpi),
    ut: "s",
    clazzId: String(course.clazzId),
    type: "",
    enc: att.enc || "",
    mooc2: "1",
    courseid: String(course.courseId),
  });
  const url = `https://mooc1.chaoxing.com/mooc-ans/api/work?${params.toString()}`;
  const html = await cx.fetchText(url, {
    headers: { Referer: "https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse" },
  });
  return parseWork(html);
}

export function parseWork(html: string): ParsedWork {
  const decodeHtml = (s: string) =>
    s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const fields: Record<string, string> = {};
  const inputRe = /<(?:input|textarea|select)\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = inputRe.exec(html))) {
    const tag = m[0];
    const name = /name="([^"]*)"/.exec(tag)?.[1] || /name='([^']*)'/.exec(tag)?.[1] || "";
    if (!name) continue;
    const value = /value="([^"]*)"/.exec(tag)?.[1] ?? /value='([^']*)'/.exec(tag)?.[1] ?? "";
    if (!(name in fields)) fields[name] = decodeHtml(value);
  }

  const questions: ParsedQuestion[] = [];
  const qRe = /<div[^>]*class="[^"]*(?:singleQuesId|questionLi)[^"]*"[^>]*data="(\d+)"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*(?:singleQuesId|questionLi)[^"]*"|<div[^>]*id="submitForm"|<\/form>|$)/gi;
  while ((m = qRe.exec(html))) {
    const qid = m[1];
    const block = m[2];
    const typeMatch = /class="[^"]*TiMu[^"]*"[^>]*data="(\d)"/.exec(block);
    const typeCode = typeMatch ? Number(typeMatch[1]) : guessTypeFromText(block);
    const titleHtml = /class="[^"]*Zy_TItle[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block)?.[1] || "";
    const rawTitle = stripTags(titleHtml).replace(/^\d+[.、．]\s*/, "").replace(/^【.*?】\s*/, "");
    const title = decryptSecretText(rawTitle);

    const options: ParsedOption[] = [];
    // 策略1: ul.Zy_ulTk > li；策略2: 带有 num_option 的任意 li；策略3: div.clearfix 块
    const optBlocks =
      /<ul[^>]*class="[^"]*Zy_ulTk[^"]*"[^>]*>([\s\S]*?)<\/ul>/i.exec(block)?.[1] ||
      /<ul[^>]*>([\s\S]*?)<\/ul>/i.exec(block)?.[1] ||
      "";
    if (optBlocks) {
      const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let li: RegExpExecArray | null;
      let idx = 0;
      while ((li = liRe.exec(optBlocks))) {
        const inner = li[1];
        const numOpt = /<span[^>]*class="[^"]*num_option[^"]*"[^>]*?(?:data="([^"]*)")?[^>]*>([\s\S]*?)<\/span>/i.exec(inner);
        const letter = numOpt ? stripTags(numOpt[2]).replace(/[.、．]$/, "") : String.fromCharCode(65 + idx);
        const value = numOpt?.[1] || letter;
        const text = decryptSecretText(
          stripTags(inner.replace(/<span[^>]*class="[^"]*num_option[^"]*"[^>]*>[\s\S]*?<\/span>/i, "")),
        );
        if (text || letter) options.push({ letter, value, text });
        idx++;
      }
    }
    questions.push({ qid, typeCode, rawTitle, title, options });
  }

  const answeredBefore = !!(fields.answerId && fields.answerId !== "0" && fields.answerId !== "");
  return { fields, questions, answeredBefore, rawHtml: html };
}

function guessTypeFromText(block: string): number {
  const t = stripTags(block);
  if (/(多选题|【多选】)/.test(t)) return 1;
  if (/(填空题|【填空】)/.test(t)) return 2;
  if (/(判断题|【判断】)/.test(t)) return 3;
  if (/(简答题|【简答】|问答)/.test(t)) return 4;
  return 0;
}

/* ---------------- 答案生成与提交 ---------------- */

export async function buildAnswerSheet(
  args: {
    course: Course;
    courseName: string;
    chapterTitle: string;
    knowledgeId: number;
    defaults: Record<string, any>;
    att: CardAttachment;
    settings: Settings;
  },
): Promise<AnswerSheet> {
  const work = await fetchWorkPage(args.course, args.knowledgeId, args.defaults, args.att);
  const questions: AnswerQuestion[] = [];
  for (const q of work.questions) {
    const optTexts = q.options.map((o) => o.text || o.letter);
    let answer: string[] = [];
    let answerText = "";
    let source = "none";
    let confidence = 0;
    if (q.typeCode === 4) {
      // 简答直接走 AI
      const r = await queryAnswer({ title: q.title, options: [], typeCode: 4 }, { settings: args.settings, subject: args.courseName });
      if (r) {
        answer = r.values;
        answerText = r.values.join(" ");
        source = r.source;
        confidence = r.confidence;
      }
    } else {
      const r = await queryAnswer({ title: q.title, options: optTexts, typeCode: q.typeCode }, { settings: args.settings, subject: args.courseName });
      if (r) {
        if (q.typeCode === 0 || q.typeCode === 1) {
          answer = r.values.map((l) => q.options[l.charCodeAt(0) - 65]?.value ?? l);
          answerText = r.values.join("");
        } else if (q.typeCode === 3) {
          const j = judgeNormalize(r.values[0] || r.answerText) || r.values[0];
          // 判断题选项值映射：按文本匹配
          const hit = q.options.find((o) => o.text.includes(j) || j.includes(o.text));
          answer = [hit?.value ?? j];
          answerText = j;
        } else {
          answer = r.values;
          answerText = r.values.join(" ");
        }
        source = r.source;
        confidence = r.confidence;
      }
    }
    questions.push({
      qid: q.qid,
      typeCode: q.typeCode,
      rawTitle: q.rawTitle,
      title: q.title,
      options: q.options.map((o) => ({ letter: o.letter, value: o.value, text: o.text })),
      answer,
      answerText,
      source,
      confidence,
    });
  }
  const sheet: AnswerSheet = {
    id: `sheet-${Date.now()}-${Math.floor(Math.random() * 1e4)}`,
    courseId: args.course.courseId,
    clazzId: args.course.clazzId,
    cpi: args.course.cpi,
    knowledgeId: args.knowledgeId,
    workId: args.att.jobid.replace(/^work-/, ""),
    jobid: args.att.jobid,
    courseName: args.courseName,
    chapterTitle: args.chapterTitle,
    formFields: work.fields,
    questions,
    status: "pending",
    createdAt: Date.now(),
    note: work.answeredBefore ? "该测验此前已作答过" : undefined,
  };
  return sheet;
}

export interface SubmitResult {
  ok: boolean;
  message: string;
  score?: number;
}

/** 提交/保存答卷 */
export async function submitSheet(sheet: AnswerSheet, saveOnly: boolean): Promise<SubmitResult> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(sheet.formFields)) {
    if (/^answerwqbid$/.test(k)) continue;
    if (/^answer\d+/.test(k) || /^answertype\d+/.test(k)) continue;
    form.set(k, v);
  }
  const qids: string[] = [];
  for (const q of sheet.questions) {
    qids.push(q.qid);
    form.set(`answertype${q.qid}`, String(q.typeCode));
    let value = "";
    if (q.typeCode === 0 || q.typeCode === 1) {
      const vals = q.answer.filter(Boolean);
      value = (q.typeCode === 1 ? vals.slice().sort().join("") : vals.join("")) as string;
    } else if (q.typeCode === 3) {
      value = String(q.answer[0] ?? "");
    } else {
      value = (q.answerText || q.answer.join(" ")).trim();
    }
    form.set(`answer${q.qid}`, value);
  }
  form.set("answerwqbid", qids.map((q) => q).join(",") + ",");
  form.set("pyFlag", saveOnly ? "1" : "");

  const res = await cx.fetch("https://mooc1.chaoxing.com/mooc-ans/work/addStudentWorkNew", {
    method: "POST",
    body: form,
    headers: {
      Referer: "https://mooc1.chaoxing.com/mooc-ans/api/work",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  const text = await res.text();
  if (res.status !== 200) return { ok: false, message: `提交失败 HTTP ${res.status}` };
  try {
    const data = JSON.parse(text);
    if (data?.status === true || data?.code === 1) {
      return { ok: true, message: saveOnly ? "已保存" : "已提交", score: data?.score };
    }
    return { ok: false, message: String(data?.msg || data?.message || "提交未成功") };
  } catch {
    if (/成功|已提交|已保存/.test(text)) return { ok: true, message: saveOnly ? "已保存" : "已提交" };
    return { ok: false, message: `响应异常: ${text.slice(0, 120)}` };
  }
}
